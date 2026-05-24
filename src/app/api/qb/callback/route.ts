import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";
import { createOAuthClient } from "@/lib/qb/oauth";
import { fetchCompanyName } from "@/lib/qb/client";
import type { QbEnvironment } from "@/lib/qb/config";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

function settingsUrl(request: Request, path: string, qs?: Record<string, string>) {
  const origin = new URL(request.url).origin;
  const url = new URL(path, origin);
  if (qs) Object.entries(qs).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// GET /api/qb/callback?code=...&state=...&realmId=...
// Validates the state cookie, exchanges the code for tokens, encrypts +
// stores them, and hands off to the setup wizard. Errors redirect back
// to /settings/money?tab=quickbooks with a query-string flag so the UI
// can show a toast.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: errorParam }),
    );
  }
  if (!code || !state || !realmId) {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "missing_params" }),
    );
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("qb_oauth_state")?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "state_mismatch" }),
    );
  }
  cookieStore.delete("qb_oauth_state");

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      settingsUrl(request, "/login"),
    );
  }
  const { data: membership } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", await getActiveOrganizationId(supabase))
    .maybeSingle<{ role: string }>();
  if (membership?.role !== "admin") {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "forbidden" }),
    );
  }

  const oauth = createOAuthClient();
  let tokenResp;
  try {
    tokenResp = await oauth.createToken(request.url);
  } catch {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "token_exchange_failed" }),
    );
  }
  const token = tokenResp.getToken();
  const accessToken = token.access_token ?? "";
  const refreshToken = token.refresh_token ?? "";
  const expiresIn = token.expires_in ?? 3600;
  const refreshExpiresIn = token.x_refresh_token_expires_in ?? 8640000;
  if (!accessToken || !refreshToken) {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "empty_tokens" }),
    );
  }

  const now = Date.now();
  const access_token_expires_at = new Date(now + expiresIn * 1000).toISOString();
  const refresh_token_expires_at = new Date(
    now + refreshExpiresIn * 1000,
  ).toISOString();

  const companyName = await fetchCompanyName({
    accessToken,
    realmId,
    environment: (process.env.QUICKBOOKS_ENVIRONMENT as QbEnvironment) ?? "sandbox",
  });

  // Service client writes tokens (bypasses RLS, which is fine — we already
  // authenticated + authorized the user above).
  const service = createServiceClient();
  const { error: upsertErr } = await service.from("qb_connection").insert({
    organization_id: await getActiveOrganizationId(supabase),
    realm_id: realmId,
    company_name: companyName,
    access_token_encrypted: encrypt(accessToken),
    refresh_token_encrypted: encrypt(refreshToken),
    access_token_expires_at,
    refresh_token_expires_at,
    dry_run_mode: true,
    is_active: true,
    connected_by: user.id,
  });
  if (upsertErr) {
    return NextResponse.redirect(
      settingsUrl(request, "/settings/money?tab=quickbooks", { oauth_error: "db_write_failed" }),
    );
  }

  return NextResponse.redirect(settingsUrl(request, "/settings/accounting/setup"));
}
