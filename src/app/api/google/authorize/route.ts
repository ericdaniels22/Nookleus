import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { buildAuthorizeUrl } from "@/lib/google/oauth";

// GET /api/google/authorize — starts the OAuth flow. Admin only. Generates a
// CSRF state token, stores it in a short (10-min) httpOnly cookie, and redirects
// to Google's consent page. Mirrors /api/qb/authorize.
//
// buildAuthorizeUrl() reads the OAuth client config and throws when it is not
// set (the #611 credentials aren't in the environment yet). Rather than 500 an
// admin who clicks Connect before those land, catch that and bounce back to the
// Connections card with ?google_error=not_configured so the UI explains it.
// Building the URL (and thus validating config) happens BEFORE the state cookie
// is set, so a bail-out never leaves a stray cookie behind.
async function getAuthorize(request: Request) {
  const state = randomBytes(24).toString("hex");

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl(state);
  } catch {
    const settings = new URL("/settings/connections", new URL(request.url).origin);
    settings.searchParams.set("google_error", "not_configured");
    return NextResponse.redirect(settings.toString());
  }

  const cookieStore = await cookies();
  cookieStore.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl);
}

export const GET = withRequestContext({ adminOnly: true }, getAuthorize);
