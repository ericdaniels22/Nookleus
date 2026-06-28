import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
  fetchUserInfo,
  isRevokedError,
  GoogleOAuthError,
} from "./oauth";
import type { GoogleOAuthConfig } from "./config";

const config: GoogleOAuthConfig = {
  clientId: "client-id-123",
  clientSecret: "client-secret-abc",
  redirectUri: "https://app.nookleus.com/api/google/callback",
};

// A fetch double that records calls and replays a queued Response. The helpers
// take fetchImpl by injection, so no global patching is needed.
function stubFetch(...responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return responses[i++] ?? new Response(null, { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyParams(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ""));
}

describe("buildAuthorizeUrl", () => {
  it("builds Google's consent URL with offline access and forced consent", () => {
    const url = new URL(buildAuthorizeUrl("state-xyz", config));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("client-id-123");
    expect(p.get("redirect_uri")).toBe("https://app.nookleus.com/api/google/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("state")).toBe("state-xyz");
    // offline + consent guarantee a refresh token comes back on (re)connect.
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("include_granted_scopes")).toBe("true");
    // Scopes are space-delimited and include identity + Business Profile.
    const scope = p.get("scope") ?? "";
    expect(scope).toContain("openid");
    expect(scope).toContain("https://www.googleapis.com/auth/business.manage");
  });
});

describe("exchangeCodeForTokens", () => {
  it("POSTs the authorization_code grant and maps the token response", async () => {
    const { fetchImpl, calls } = stubFetch(
      json({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3599,
        scope: "openid https://www.googleapis.com/auth/business.manage",
        id_token: "idt-1",
      }),
    );

    const result = await exchangeCodeForTokens("auth-code", { config, fetchImpl });

    expect(result).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresIn: 3599,
      scopes: ["openid", "https://www.googleapis.com/auth/business.manage"],
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    const sent = bodyParams(calls[0].init);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("auth-code");
    expect(sent.get("client_id")).toBe("client-id-123");
    expect(sent.get("client_secret")).toBe("client-secret-abc");
    expect(sent.get("redirect_uri")).toBe("https://app.nookleus.com/api/google/callback");
  });

  it("throws a GoogleOAuthError carrying Google's error code on failure", async () => {
    const { fetchImpl } = stubFetch(json({ error: "invalid_request" }, 400));
    await expect(
      exchangeCodeForTokens("bad", { config, fetchImpl }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("refreshAccessToken", () => {
  it("POSTs the refresh_token grant and maps the new access token", async () => {
    const { fetchImpl, calls } = stubFetch(
      json({ access_token: "at-2", expires_in: 3600, scope: "openid" }),
    );

    const result = await refreshAccessToken("rt-1", { config, fetchImpl });

    expect(result).toEqual({ accessToken: "at-2", expiresIn: 3600, scopes: ["openid"] });
    const sent = bodyParams(calls[0].init);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("rt-1");
    expect(sent.get("client_id")).toBe("client-id-123");
    expect(sent.get("client_secret")).toBe("client-secret-abc");
  });

  it("classifies a revoked/expired refresh token (invalid_grant) as revoked", async () => {
    const { fetchImpl } = stubFetch(json({ error: "invalid_grant" }, 400));
    let caught: unknown;
    try {
      await refreshAccessToken("revoked", { config, fetchImpl });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GoogleOAuthError);
    expect(isRevokedError(caught)).toBe(true);
  });

  it("does NOT classify a transient 5xx as revoked", async () => {
    const { fetchImpl } = stubFetch(new Response("upstream", { status: 503 }));
    let caught: unknown;
    try {
      await refreshAccessToken("rt-1", { config, fetchImpl });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GoogleOAuthError);
    expect(isRevokedError(caught)).toBe(false);
  });
});

describe("revokeToken", () => {
  it("POSTs the token to Google's revoke endpoint", async () => {
    const { fetchImpl, calls } = stubFetch(new Response(null, { status: 200 }));
    await revokeToken("rt-1", { config, fetchImpl });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(bodyParams(calls[0].init).get("token")).toBe("rt-1");
  });
});

describe("fetchUserInfo", () => {
  it("GETs the OIDC userinfo with a bearer token and returns email + name", async () => {
    const { fetchImpl, calls } = stubFetch(
      json({ email: "owner@aaadisasterrecovery.com", name: "AAA Owner" }),
    );
    const info = await fetchUserInfo("at-1", { fetchImpl });
    expect(info).toEqual({ email: "owner@aaadisasterrecovery.com", name: "AAA Owner" });
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer at-1");
  });
});

describe("isRevokedError", () => {
  it("is false for a plain Error", () => {
    expect(isRevokedError(new Error("boom"))).toBe(false);
  });
  it("is true only for an invalid_grant GoogleOAuthError", () => {
    expect(isRevokedError(new GoogleOAuthError("invalid_grant", "revoked"))).toBe(true);
    expect(isRevokedError(new GoogleOAuthError("http_503", "down"))).toBe(false);
  });
});
