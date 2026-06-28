import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";
import { exchangeCodeForTokens, fetchUserInfo } from "@/lib/google/oauth";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

const SETTINGS_PATH = "/settings/connections";

function settingsUrl(request: Request, qs?: Record<string, string>) {
  const origin = new URL(request.url).origin;
  const url = new URL(SETTINGS_PATH, origin);
  if (qs) Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// GET /api/google/callback?code=...&state=...
// Validates the CSRF state cookie, re-checks the caller is an admin of the
// Active Organization, exchanges the code for tokens, fetches the connected
// account for display, and upserts ONE encrypted google_connection row per
// Organization (a reconnect overwrites the prior row and clears any broken
// state). Errors redirect back to settings with a ?google_error flag so the
// card can show a toast. Mirrors /api/qb/callback.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(settingsUrl(request, { google_error: errorParam }));
  }
  if (!code || !state) {
    return NextResponse.redirect(settingsUrl(request, { google_error: "missing_params" }));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("google_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(settingsUrl(request, { google_error: "state_mismatch" }));
  }
  cookieStore.delete("google_oauth_state");

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", new URL(request.url).origin).toString());
  }
  const orgId = await getActiveOrganizationId(supabase);
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle<{ role: string }>();
  if (membership?.role !== "admin") {
    return NextResponse.redirect(settingsUrl(request, { google_error: "forbidden" }));
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch {
    return NextResponse.redirect(settingsUrl(request, { google_error: "token_exchange_failed" }));
  }
  // Without a refresh token the connection can't survive its first hour — force
  // a reconnect (prompt=consent should always return one; this guards the edge).
  if (!tokens.refreshToken) {
    return NextResponse.redirect(settingsUrl(request, { google_error: "no_refresh_token" }));
  }

  // Display-only; a failure here must not block the connection.
  let info = { email: null as string | null, name: null as string | null };
  try {
    info = await fetchUserInfo(tokens.accessToken);
  } catch {
    // leave email/name null — the card still shows "Connected".
  }

  const now = Date.now();
  const access_token_expires_at = new Date(now + tokens.expiresIn * 1000).toISOString();

  // Service client writes tokens (bypasses RLS — we already authorized above).
  const service = createServiceClient();
  const { error: upsertErr } = await service.from("google_connection").upsert(
    {
      organization_id: orgId,
      google_account_email: info.email,
      google_account_name: info.name,
      refresh_token_encrypted: encrypt(tokens.refreshToken),
      access_token_encrypted: encrypt(tokens.accessToken),
      access_token_expires_at,
      scopes: tokens.scopes,
      status: "connected",
      broken_reason: null,
      broken_at: null,
      connected_by: user.id,
    },
    { onConflict: "organization_id" },
  );
  if (upsertErr) {
    return NextResponse.redirect(settingsUrl(request, { google_error: "db_write_failed" }));
  }

  return NextResponse.redirect(settingsUrl(request, { google: "connected" }));
}
