// Env access + endpoint/scopes constants for the Google connection. Mirrors
// src/lib/qb/config.ts: throws at call time with a useful message if required
// vars are missing — never at import time (so a missing creds env doesn't break
// unrelated pages).
//
// The OAuth client id/secret come from the Google Cloud project (issue #611).
// Required env (set in prod + local dev):
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REDIRECT_URI   e.g. https://app.nookleus.com/api/google/callback
//                               (and http://localhost:3000/api/google/callback locally)

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// True only when the OAuth client env is fully present (the #611 credentials
// are in the environment). The Settings card reads this to avoid offering
// Connect before the credentials exist — getGoogleOAuthConfig() throws in that
// state, so this is the non-throwing probe for "can we start the flow?".
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  const missing: string[] = [];
  if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!redirectUri) missing.push("GOOGLE_OAUTH_REDIRECT_URI");
  if (missing.length > 0) {
    throw new Error(`Google OAuth env misconfigured — missing: ${missing.join(", ")}`);
  }

  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! };
}

// Google OAuth 2.0 / OIDC endpoints — single source of truth for the fetch-based
// helpers in oauth.ts (this repo prefers raw fetch over an SDK for these APIs,
// the same call qb/config.ts makes for the QBO REST API).
export const GOOGLE_OAUTH_ENDPOINTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
} as const;

// The scopes requested at connect time. Slice ① (this connection + reviews)
// needs identity (to display the connected account) and Business Profile.
// Later slices APPEND to this list as they ship — Search Console (#607) adds
// webmasters.readonly, Ads (#610) adds adwords — so a reconnect with
// include_granted_scopes=true incrementally widens the single link (user
// story #1: "connect once, everything flows"). Adding a scope here is the only
// change those slices need to widen consent.
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/business.manage",
] as const;
