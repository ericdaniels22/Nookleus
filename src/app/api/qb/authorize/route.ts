import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createOAuthClient, QB_SCOPES } from "@/lib/qb/oauth";

// GET /api/qb/authorize — starts the OAuth flow. Admin only. Generates a
// CSRF state token, stores it in a short (10-min) httpOnly cookie, and
// redirects to Intuit's consent page.
async function getAuthorize() {
  const state = randomBytes(24).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set("qb_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const oauth = createOAuthClient();
  const authUrl = oauth.authorizeUri({ scope: QB_SCOPES, state });
  return NextResponse.redirect(authUrl);
}

export const GET = withRequestContext({ adminOnly: true }, getAuthorize);
