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

// #789 — the consent screen for project `nookleus` is in "Testing" until it is
// published to Production. While in Testing, Google expires the business.manage
// *sensitive*-scope refresh token 7 days after consent, so the per-org
// connection silently breaks a week after an admin connects.
export const GOOGLE_TESTING_REFRESH_TOKEN_TTL_DAYS = 7;

// Whether the consent screen is still in Testing (so the 7-day expiry applies).
// Defaults to true — Testing is the current reality, and over-warning is safer
// than letting the token lapse unnoticed. Set GOOGLE_OAUTH_TESTING_MODE=false
// (or "production") the moment the app is published to Production, and the
// Marketing-page countdown disappears on its own.
export function isGoogleOAuthTestingMode(): boolean {
  const raw = (process.env.GOOGLE_OAUTH_TESTING_MODE ?? "").trim().toLowerCase();
  if (raw === "") return true;
  return !["false", "0", "no", "off", "production", "prod"].includes(raw);
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

// Google Business Profile API hosts — the reviews inbox (#604) reads these.
// Reviews live ONLY in the legacy My Business v4 API; account + location
// discovery uses the modern split APIs (Account Management + Business
// Information). Single source of truth for the fetch helpers in reviews.ts.
export const GOOGLE_BUSINESS_ENDPOINTS = {
  // GET {reviewsBase}/{accounts/*/locations/*}/reviews
  reviewsBase: "https://mybusiness.googleapis.com/v4",
  // GET {accounts} → the Business Profile accounts the user can manage
  accounts: "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
  // GET {businessInformationBase}/{accounts/*}/locations?readMask=name
  businessInformationBase: "https://mybusinessbusinessinformation.googleapis.com/v1",
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
