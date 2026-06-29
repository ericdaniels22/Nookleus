// ENCRYPTION_KEY must exist before the route's store layer encrypts. 32B hex.
process.env.ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  makeAuthedFake,
  makeUnauthedFake,
} from "@/lib/contracts/__test-utils__/supabase-fake";
import { decrypt } from "@/lib/encryption";

// A service-client fake that supports the website_connection chains the connect
// route exercises: upsert(values, { onConflict }) and the select().eq()
// .maybeSingle() re-read. Rows are exposed so a test can prove what was stored.
function makeServiceFake(
  rows: Record<string, unknown>[] = [],
  opts: { upsertError?: string; readError?: boolean } = {},
) {
  const client = {
    from(table: string) {
      if (table !== "website_connection") throw new Error(`unexpected table: ${table}`);
      return {
        async upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          if (opts.upsertError) {
            return { data: null, error: { message: opts.upsertError } };
          }
          const key = options?.onConflict ?? "id";
          const existing = rows.find((r) => r[key] === values[key]);
          if (existing) Object.assign(existing, values);
          else rows.push({ ...values });
          return { data: null, error: null };
        },
        select() {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return api;
            },
            async maybeSingle() {
              // Model a transient read failure: getWebsiteConnection swallows the
              // error and returns null, exactly as the prod store does.
              if (opts.readError) return { data: null, error: { message: "read blip" } };
              const match = rows.find((r) => filters.every(([c, v]) => r[c] === v));
              return { data: match ?? null, error: null };
            },
          };
          return api;
        },
      };
    },
  };
  return { client, rows };
}

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/website/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const routeCtx = { params: Promise.resolve({}) };

// A WordPress /users/me?context=edit response with publish rights.
function wpUserResponse(canPublish = true, name = "AAA Disaster Recovery") {
  return new Response(
    JSON.stringify({ name, capabilities: { publish_posts: canPublish } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const validBody = {
  siteUrl: "aaadisasterrecovery.com",
  username: "marketing",
  applicationPassword: "abcd efgh ijkl mnop",
};

describe("POST /api/website/connect (#612)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates the credential and stores it ENCRYPTED, returning connected", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => wpUserResponse(true)),
    );

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe("connected");
    expect(json.site_url).toBe("https://aaadisasterrecovery.com");
    expect(json.account_name).toBe("AAA Disaster Recovery");

    // The credential is stored ENCRYPTED — never plaintext — and decrypts back.
    expect(svc.rows).toHaveLength(1);
    const stored = svc.rows[0].application_password_encrypted as string;
    expect(stored).not.toContain("abcd efgh ijkl mnop");
    expect(decrypt(stored)).toBe("abcd efgh ijkl mnop");
    expect(svc.rows[0].organization_id).toBe("org-1");
    expect(svc.rows[0].connected_by).toBe("user-1");

    // The response body must NEVER carry the password (encrypted or otherwise).
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("application_password");
    expect(raw).not.toContain(stored);
  });

  it("returns 401 when unauthenticated (handler never runs)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeUnauthedFake() as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(401);
    // No WordPress call — the gate stops the handler before any validation.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin member (admin only)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "member" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 when a required field is missing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
    vi.stubGlobal("fetch", vi.fn());

    const res = await POST(
      makeRequest({ siteUrl: "example.com", username: "", applicationPassword: "x" }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_fields");
  });

  it("rejects an invalid credential (WordPress 401) as 422 without storing it", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "incorrect_password" }), { status: 401 })),
    );

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_credentials");
    expect(svc.rows).toHaveLength(0); // nothing stored
  });

  it("rejects a credential that cannot publish posts as 422 without storing it", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal("fetch", vi.fn(async () => wpUserResponse(false)));

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("cannot_publish_posts");
    expect(svc.rows).toHaveLength(0);
  });

  it("reports a transient WordPress outage (5xx) as 502, never storing or breaking", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("wordpress_unreachable");
    expect(svc.rows).toHaveLength(0);
  });

  it("reports a network rejection (fetch throws) as 502, never storing or breaking", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake();
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("wordpress_unreachable");
    expect(svc.rows).toHaveLength(0);
  });

  it("rejects a non-object JSON body as 400 invalid_body before touching WordPress", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // A JSON `null` body parses successfully — it must be rejected as invalid,
    // not crash the handler on a property access.
    const res = await POST(makeRequest(null), routeCtx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unparseable site URL as 400 invalid_site_url before touching WordPress", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(makeServiceFake().client as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // "https://" survives the missing-fields guard (non-empty) but has no host,
    // so normalizeSiteUrl throws → invalid_site_url, and no WordPress call fires.
    const res = await POST(
      makeRequest({ ...validBody, siteUrl: "https://" }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_site_url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a connected summary on 200 even if the post-write re-read blips", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    // The upsert succeeds; the convenience re-read transiently fails (returns
    // null). The response must still report CONNECTED — a 200 that returns a
    // 'disconnected' summary makes the card fire "Website connected" yet flip
    // back to the empty form for a credential that was actually written.
    const svc = makeServiceFake([], { readError: true });
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal("fetch", vi.fn(async () => wpUserResponse(true)));

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe("connected");
    expect(json.site_url).toBe("https://aaadisasterrecovery.com");
    expect(json.account_name).toBe("AAA Disaster Recovery");
    // The row really was written.
    expect(svc.rows).toHaveLength(1);
    // And the fallback still never leaks the password.
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("abcd efgh ijkl mnop");
    expect(raw).not.toContain("application_password");
  });

  it("returns 500 db_write_failed when the upsert fails, leaking nothing", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      makeAuthedFake("user-1", { role: "admin" }) as never,
    );
    const svc = makeServiceFake([], { upsertError: "boom" });
    vi.mocked(createServiceClient).mockReturnValue(svc.client as never);
    vi.stubGlobal("fetch", vi.fn(async () => wpUserResponse(true)));

    const res = await POST(makeRequest(validBody), routeCtx);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("db_write_failed");
    // The error response carries no credential material of any kind.
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("abcd efgh ijkl mnop");
    expect(raw).not.toContain("application_password");
  });
});
