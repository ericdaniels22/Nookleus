import { NextResponse, type NextRequest } from "next/server";
import { verifyOAuthState, InvalidOAuthStateError } from "@/lib/stripe-oauth";
import { createServiceClient } from "@/lib/supabase-api";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

interface StripeOAuthTokenResponse {
  stripe_user_id: string;
  stripe_publishable_key: string;
  access_token: string;
  livemode: boolean;
  scope: string;
  error?: string;
  error_description?: string;
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const back = (msg: string) => {
    const dest = new URL(`${appUrl}/settings/money`);
    dest.searchParams.set("tab", "stripe");
    dest.searchParams.set("connect_error", msg);
    return NextResponse.redirect(dest.toString(), { status: 303 });
  };

  if (errorParam) {
    const safe = errorParam === "access_denied" ? "access_denied" : "oauth_error";
    if (errorParam !== "access_denied") {
      console.error("[stripe/connect/callback] upstream error:", errorParam);
    }
    return back(safe);
  }
  if (!code || !stateParam) return back("missing_params");

  let payload: ReturnType<typeof verifyOAuthState>;
  try {
    payload = verifyOAuthState(stateParam);
  } catch (e) {
    if (e instanceof InvalidOAuthStateError) return back("invalid_state");
    throw e;
  }

  // Best-effort session match: if we have a session, it must belong to the user
  // who signed the state. If we have no session (cookies can be stripped on some
  // external redirects), the HMAC state is still the authoritative gate.
  try {
    const auth = await createServerSupabaseClient();
    const {
      data: { user: sessionUser },
    } = await auth.auth.getUser();
    if (sessionUser && sessionUser.id !== payload.user_id) {
      return back("session_mismatch");
    }
  } catch {
    // Non-fatal: continue with state as the only gate.
  }

  const platformSecret = process.env.STRIPE_CONNECT_CLIENT_SECRET;
  if (!platformSecret) {
    return back("platform_secret_missing");
  }

  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort(), 8000);
  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_secret: platformSecret,
        code,
        grant_type: "authorization_code",
      }),
      signal: ac.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return back("stripe_timeout");
    }
    console.error("[stripe/connect/callback] fetch threw:", e);
    return back("stripe_fetch_failed");
  } finally {
    clearTimeout(timeoutHandle);
  }
  const token = (await tokenRes.json()) as StripeOAuthTokenResponse;
  if (!tokenRes.ok || token.error) {
    console.error("[stripe/connect/callback] token exchange failed:", {
      status: tokenRes.status,
      error: token.error,
      error_description: token.error_description,
    });
    return back("token_exchange_failed");
  }

  const authClient = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(authClient);
  const supabase = createServiceClient();
  // One-row-per-org pattern: delete the existing row for this org, insert fresh.
  await supabase
    .from("stripe_connection")
    .delete()
    .eq("organization_id", orgId);
  const { error: insertErr } = await supabase.from("stripe_connection").insert({
    organization_id: orgId,
    stripe_account_id: token.stripe_user_id,
    publishable_key: token.stripe_publishable_key,
    secret_key_encrypted: encrypt(token.access_token),
    mode: token.livemode ? "live" : "test",
    last_connected_at: new Date().toISOString(),
    connected_by: payload.user_id,
  });
  if (insertErr) return back("db_insert_failed");

  const dest = new URL(`${appUrl}/settings/money`);
  dest.searchParams.set("tab", "stripe");
  dest.searchParams.set("connected", "1");
  return NextResponse.redirect(dest.toString(), { status: 303 });
}
