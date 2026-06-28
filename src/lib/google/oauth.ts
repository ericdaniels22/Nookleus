// Google OAuth 2.0 / OIDC mechanics over raw fetch. No SDK: Google's token,
// revoke, and userinfo endpoints are clean REST, and this repo already prefers
// fetch for third-party APIs (see qb/config.ts). Every network helper takes its
// fetch implementation by injection so the flow is unit-testable without
// patching globals.
//
// Errors surface as GoogleOAuthError carrying Google's own `error` code. The one
// code that matters downstream is "invalid_grant" — a revoked or expired refresh
// token — which the deep module turns into the connection's broken state. Every
// other failure (4xx misconfig, 5xx, network) is transient: isRevokedError()
// returns false, so the connection is never falsely broken.

import {
  getGoogleOAuthConfig,
  GOOGLE_OAUTH_ENDPOINTS,
  GOOGLE_SCOPES,
  type GoogleOAuthConfig,
} from "./config";

export class GoogleOAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

// The single signal the deep module branches on: was this failure a revoked /
// expired refresh token? Only then is the connection broken.
export function isRevokedError(err: unknown): boolean {
  return err instanceof GoogleOAuthError && err.code === "invalid_grant";
}

interface OAuthDeps {
  config?: GoogleOAuthConfig;
  fetchImpl?: typeof fetch;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

export interface TokenRefreshResult {
  accessToken: string;
  expiresIn: number;
  scopes: string[];
}

export interface GoogleUserInfo {
  email: string | null;
  name: string | null;
}

// The consent URL. offline + consent guarantee a refresh token on every
// (re)connect; include_granted_scopes lets later slices widen the grant
// incrementally without dropping scopes already granted.
export function buildAuthorizeUrl(
  state: string,
  config: GoogleOAuthConfig = getGoogleOAuthConfig(),
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_OAUTH_ENDPOINTS.authorize}?${params.toString()}`;
}

function parseScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

// Turn a non-ok response into a GoogleOAuthError. Google returns
// { error, error_description } JSON on token failures; fall back to http_<status>
// for a non-JSON body (e.g. a 5xx HTML/text page) so transient errors stay
// distinguishable from invalid_grant.
async function toOAuthError(res: Response): Promise<GoogleOAuthError> {
  let code = `http_${res.status}`;
  let message = `Google endpoint returned ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown; error_description?: unknown };
    if (typeof body.error === "string") {
      code = body.error;
      message =
        typeof body.error_description === "string" ? body.error_description : body.error;
    }
  } catch {
    // non-JSON body — keep the http_<status> code.
  }
  return new GoogleOAuthError(code, message);
}

function postForm(
  url: string,
  params: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

export async function exchangeCodeForTokens(
  code: string,
  deps: OAuthDeps = {},
): Promise<TokenExchangeResult> {
  const config = deps.config ?? getGoogleOAuthConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await postForm(
    GOOGLE_OAUTH_ENDPOINTS.token,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
    fetchImpl,
  );
  if (!res.ok) throw await toOAuthError(res);
  const t = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(t.access_token ?? ""),
    refreshToken: String(t.refresh_token ?? ""),
    expiresIn: typeof t.expires_in === "number" ? t.expires_in : 3600,
    scopes: parseScopes(t.scope),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  deps: OAuthDeps = {},
): Promise<TokenRefreshResult> {
  const config = deps.config ?? getGoogleOAuthConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await postForm(
    GOOGLE_OAUTH_ENDPOINTS.token,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
    fetchImpl,
  );
  if (!res.ok) throw await toOAuthError(res);
  const t = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(t.access_token ?? ""),
    expiresIn: typeof t.expires_in === "number" ? t.expires_in : 3600,
    scopes: parseScopes(t.scope),
  };
}

// Best-effort revocation at Google. A 400 for an already-invalid token is fine;
// only a network failure (fetch reject) propagates, and disconnect swallows it
// so the local row is always deleted regardless.
export async function revokeToken(token: string, deps: OAuthDeps = {}): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await postForm(
    GOOGLE_OAUTH_ENDPOINTS.revoke,
    new URLSearchParams({ token }),
    fetchImpl,
  );
  return res.ok;
}

export async function fetchUserInfo(
  accessToken: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<GoogleUserInfo> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(GOOGLE_OAUTH_ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await toOAuthError(res);
  const u = (await res.json()) as { email?: unknown; name?: unknown };
  return {
    email: typeof u.email === "string" ? u.email : null,
    name: typeof u.name === "string" ? u.name : null,
  };
}
