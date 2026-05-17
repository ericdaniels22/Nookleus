import { NextResponse } from "next/server";
import { signOAuthState } from "@/lib/stripe-oauth";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// Starting the Stripe Connect OAuth flow needs the `access_settings`
// permission (admins auto-pass) — mapped 1:1 from the old gate.
export const POST = withRequestContext(
  { permission: "access_settings" },
  async (_request, ctx) => {
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!clientId) {
      return NextResponse.json({ error: "STRIPE_CONNECT_CLIENT_ID not set" }, { status: 500 });
    }
    if (!appUrl) {
      return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL not set" }, { status: 500 });
    }

    const state = signOAuthState(ctx.userId);
    const redirectUri = `${appUrl}/api/stripe/connect/callback`;
    const oauthUrl = new URL("https://connect.stripe.com/oauth/authorize");
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("client_id", clientId);
    oauthUrl.searchParams.set("scope", "read_write");
    oauthUrl.searchParams.set("redirect_uri", redirectUri);
    oauthUrl.searchParams.set("state", state);
    oauthUrl.searchParams.set("stripe_user[business_type]", "company");

    return NextResponse.redirect(oauthUrl.toString(), { status: 303 });
  },
);
