import { describe, it, expect } from "vitest";
import {
  normalizeSiteUrl,
  validateCredential,
  isRevokedError,
  WordPressError,
} from "./wordpress";

// #612 — the site URL an admin pastes is normalised once at connect time: it
// becomes both the display value ("Connected to example.com") and the base every
// REST call is built on, so a trailing slash or a missing scheme must not change
// where the requests land.

// A fetch double that records calls and replays a queued Response — the client
// takes fetchImpl by injection, so no global patching is needed. Mirrors the
// helper in src/lib/google/oauth.test.ts.
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

describe("normalizeSiteUrl", () => {
  it("adds https:// when the scheme is missing", () => {
    expect(normalizeSiteUrl("example.com")).toBe("https://example.com");
  });

  it("strips a trailing slash", () => {
    expect(normalizeSiteUrl("https://example.com/")).toBe("https://example.com");
  });

  it("preserves a subdirectory install but drops its trailing slash", () => {
    expect(normalizeSiteUrl("https://example.com/blog/")).toBe(
      "https://example.com/blog",
    );
  });

  it("lower-cases the host but leaves the path case intact", () => {
    expect(normalizeSiteUrl("https://Example.COM/Blog")).toBe(
      "https://example.com/Blog",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSiteUrl("  example.com  ")).toBe("https://example.com");
  });

  it("keeps an explicit http:// scheme (local / legacy installs)", () => {
    expect(normalizeSiteUrl("http://example.com/")).toBe("http://example.com");
  });
});

describe("validateCredential", () => {
  it("GETs /users/me?context=edit with Basic auth and reports publish rights", async () => {
    const { fetchImpl, calls } = stubFetch(
      json({
        name: "AAA Disaster Recovery",
        capabilities: { publish_posts: true, edit_posts: true },
      }),
    );

    const result = await validateCredential(
      {
        siteUrl: "https://aaadisasterrecovery.com",
        username: "marketing",
        applicationPassword: "abcd efgh ijkl mnop",
      },
      { fetchImpl },
    );

    expect(result).toEqual({
      accountName: "AAA Disaster Recovery",
      canPublishPosts: true,
    });

    // The probe is a single side-effect-free GET against the edit context — it
    // must NOT create or delete a post to test write access.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://aaadisasterrecovery.com/wp-json/wp/v2/users/me?context=edit",
    );
    expect((calls[0].init?.method ?? "GET").toUpperCase()).toBe("GET");

    // Authorization is HTTP Basic of `username:application_password`.
    const headers = new Headers(calls[0].init?.headers);
    const auth = headers.get("authorization") ?? "";
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
    expect(decoded).toBe("marketing:abcd efgh ijkl mnop");
  });

  it("classifies a 401 (revoked/changed password) as a revoked error", async () => {
    const { fetchImpl } = stubFetch(
      json({ code: "incorrect_password", message: "bad creds" }, 401),
    );
    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "bad" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WordPressError);
    expect(isRevokedError(caught)).toBe(true);
  });

  it("does NOT classify a transient 5xx as revoked", async () => {
    const { fetchImpl } = stubFetch(new Response("upstream down", { status: 503 }));
    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "p" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WordPressError);
    expect(isRevokedError(caught)).toBe(false);
  });

  it("reports canPublishPosts false when the account lacks the capability", async () => {
    const { fetchImpl } = stubFetch(
      json({ name: "Editor Bob", capabilities: { edit_posts: true } }),
    );
    const result = await validateCredential(
      { siteUrl: "https://example.com", username: "bob", applicationPassword: "p" },
      { fetchImpl },
    );
    expect(result).toEqual({ accountName: "Editor Bob", canPublishPosts: false });
  });

  // The site URL is user-supplied, so a slow/hung host must not pin the connect
  // request open until the platform's function timeout fires (a 504). The fetch
  // carries an abort signal; a timeout is a non-WordPressError, so it is
  // transient (isRevokedError false → the route maps it to 502, never broken).
  it("passes an abort signal and classifies a timeout as transient, not revoked", async () => {
    let sawSignal: unknown;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal;
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "p" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }

    expect(sawSignal).toBeInstanceOf(AbortSignal);
    expect(isRevokedError(caught)).toBe(false);
  });

  // A genuine network-level rejection (DNS failure, connection refused, TLS
  // error) propagates as a non-WordPressError — transient, never revoked.
  it("propagates a network rejection as a non-revoked error", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "p" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect(isRevokedError(caught)).toBe(false);
  });

  // A 200 whose body is not JSON (e.g. an HTML page from a caching proxy) cannot
  // be read for capabilities — it throws, and that throw is transient, not a
  // revoked credential.
  it("treats a malformed-JSON 200 as transient, not revoked", async () => {
    const { fetchImpl } = stubFetch(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "p" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(isRevokedError(caught)).toBe(false);
  });

  // A 404 (the URL is not a WordPress site / wp-json is missing) is transient —
  // only a 401 is the revoked-credential signal.
  it("does NOT classify a 404 (not a WordPress site) as revoked", async () => {
    const { fetchImpl } = stubFetch(json({ code: "rest_no_route" }, 404));

    let caught: unknown;
    try {
      await validateCredential(
        { siteUrl: "https://example.com", username: "u", applicationPassword: "p" },
        { fetchImpl },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(WordPressError);
    expect(isRevokedError(caught)).toBe(false);
  });
});

describe("isRevokedError", () => {
  it("is false for a plain Error", () => {
    expect(isRevokedError(new Error("boom"))).toBe(false);
  });

  it("is true only for a 401 WordPressError, not a transient one", () => {
    expect(isRevokedError(new WordPressError(401, "invalid_credentials", "no"))).toBe(true);
    expect(isRevokedError(new WordPressError(503, "http_503", "down"))).toBe(false);
  });
});
