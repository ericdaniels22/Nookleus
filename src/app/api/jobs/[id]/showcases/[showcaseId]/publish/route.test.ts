// POST /api/jobs/[id]/showcases/[showcaseId]/publish — push a Showcase live to
// the Organization's connected WordPress site (#606). These tests pin the
// orchestration the route owns: the admin gate, the one-click consent gate, the
// publish-time privacy scrub, the connection preconditions, the create-vs-update
// hand-off to the publisher, the distinct revoked-vs-unreachable error mapping,
// and the publish-state stamp written back on success. The WordPress REST client
// itself is unit-tested in src/lib/website/wordpress.test.ts; here it is mocked
// so a route test never touches the network.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));
// Decrypt is a passthrough in the test — the stored Application Password is
// modelled as already-plaintext so we don't need a real ENCRYPTION_KEY.
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn((value: string) => value),
}));
// Keep the real error contract (WordPressError, isRevokedError) and stub only
// the network-touching publisher so the route test stays offline.
vi.mock("@/lib/website/wordpress", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/website/wordpress")>();
  return { ...actual, publishShowcasePost: vi.fn() };
});

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { publishShowcasePost, WordPressError } from "@/lib/website/wordpress";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, showcaseId: string) {
  return { params: Promise.resolve({ id, showcaseId }) };
}

function publishRequest(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A service client carrying a healthy WordPress connection for the active org,
// so a test can reach the publish step. Override the row per test as needed.
function connectedServiceClient(overrides: Record<string, unknown> = {}) {
  return fakeServiceClient({
    tables: {
      website_connection: [
        {
          id: "conn-1",
          organization_id: "org-1",
          provider: "wordpress",
          site_url: "https://example.com",
          username: "admin",
          application_password_encrypted: "secret",
          account_name: "Example",
          status: "connected",
          broken_reason: null,
          broken_at: null,
          connected_by: "user-1",
          created_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2026-05-01T00:00:00.000Z",
          ...overrides,
        },
      ],
    },
  });
}

// A draft Showcase whose write-up is clean of any customer PII, so a test can
// reach a gate past the scrub without tripping it. Override per test as needed.
function draftShowcase(overrides: Record<string, unknown> = {}) {
  return {
    id: "sc-1",
    organization_id: "org-1",
    job_id: "job-1",
    title: "Storm-torn roof, made whole",
    write_up: "We replaced the whole roof after the spring storms.",
    photo_ids: [],
    status: "draft",
    wordpress_post_id: null,
    wordpress_post_url: null,
    published_at: null,
    consent_confirmed_by: null,
    consent_confirmed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  // The route builds public photo URLs from this base; pin it for determinism.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
});

describe("POST /api/jobs/[id]/showcases/[showcaseId]/publish", () => {
  it("404s when the Showcase does not exist (no consent leak)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: { showcases: [] },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("422s with consent_required when consent is missing or false", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: { showcases: [draftShowcase()] },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);

    const res = await POST(
      publishRequest({ consent: false }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("consent_required");
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("422s with privacy_scrub_blocked when the write-up still shows customer PII", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: {
            showcases: [
              draftShowcase({
                write_up: "John Smith was thrilled with his new roof at 123 Main St.",
              }),
            ],
            jobs: [
              {
                id: "job-1",
                contact_id: "contact-1",
                property_address: "123 Main St, Springfield, IL",
              },
            ],
            contacts: [{ id: "contact-1", full_name: "John Smith" }],
          },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("privacy_scrub_blocked");
    // Both needles leaked — the route must report each so the admin can remove them.
    expect(body.violations).toEqual(
      expect.arrayContaining([
        { field: "customer_name", match: "John Smith" },
        { field: "address", match: "123 Main St" },
      ]),
    );
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("409s with not_connected when the Organization has no Website connection", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: { showcases: [draftShowcase()] },
        }),
      }) as never,
    );
    // No website_connection row seeded — the connection does not exist.
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("not_connected");
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("409s with connection_broken when the Website connection is in the broken state", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: { showcases: [draftShowcase()] },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          website_connection: [
            {
              id: "conn-1",
              organization_id: "org-1",
              provider: "wordpress",
              site_url: "https://example.com",
              username: "admin",
              application_password_encrypted: "secret",
              account_name: "Example",
              status: "broken",
              broken_reason: "Application Password revoked",
              broken_at: "2026-06-01T00:00:00.000Z",
              connected_by: "user-1",
              created_at: "2026-05-01T00:00:00.000Z",
              updated_at: "2026-06-01T00:00:00.000Z",
            },
          ],
        },
      }) as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    // Distinct from not_connected — the UI shows a reconnect prompt, not "set up".
    expect(body.code).toBe("connection_broken");
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("creates a new post and stamps the Showcase published on first publish", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: { showcases: [draftShowcase()] },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );
    vi.mocked(publishShowcasePost).mockResolvedValue({
      id: "42",
      url: "https://example.com/projects/storm-roof",
    });

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // First publish → a CREATE: the publisher is handed a null existing post id.
    expect(publishShowcasePost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publishShowcasePost).mock.calls[0][2]).toBeNull();

    // The Showcase is stamped published with the remote post id + URL and the
    // one-click consent audit (who + when).
    const update = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(update?.payload).toMatchObject({
      status: "published",
      wordpress_post_id: "42",
      wordpress_post_url: "https://example.com/projects/storm-roof",
      consent_confirmed_by: "user-1",
    });
    const payload = update?.payload as Record<string, unknown>;
    expect(typeof payload.published_at).toBe("string");
    expect(typeof payload.consent_confirmed_at).toBe("string");

    // The response reflects the now-live post for the UI.
    expect(body.state).toBe("published");
    expect(body.liveUrl).toBe("https://example.com/projects/storm-roof");
  });

  it("re-pushes the SAME post (never a duplicate) when re-publishing an edit", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-2" },
      tables: memberTables({
        userId: "user-2",
        role: "admin",
        extraTables: {
          showcases: [
            draftShowcase({
              status: "published",
              wordpress_post_id: "42",
              wordpress_post_url: "https://example.com/projects/storm-roof",
              published_at: "2026-06-01T00:00:00.000Z",
            }),
          ],
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );
    vi.mocked(publishShowcasePost).mockResolvedValue({
      id: "42",
      url: "https://example.com/projects/storm-roof",
    });

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    // The recorded post id is handed back to the publisher → UPDATE, not create.
    expect(vi.mocked(publishShowcasePost).mock.calls[0][2]).toBe("42");
    // Re-affirming consent re-stamps the latest who.
    const update = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(update?.payload).toMatchObject({ consent_confirmed_by: "user-2" });
  });

  it("marks the connection broken and returns invalid_credentials on a 401", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: { showcases: [draftShowcase()] },
      }),
    });
    const serviceClient = connectedServiceClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(serviceClient as never);
    vi.mocked(publishShowcasePost).mockRejectedValue(
      new WordPressError(401, "incorrect_password", "Unauthorized"),
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("invalid_credentials");
    // A 401 is the revoked signal: flip the connection broken so the card prompts
    // a reconnect.
    const brokenFlip = serviceClient.__mutations.find(
      (m) => m.table === "website_connection" && m.op === "update",
    );
    expect(brokenFlip?.payload).toMatchObject({ status: "broken" });
    // Nothing was published, so the Showcase must NOT be stamped published.
    const stamp = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(stamp).toBeUndefined();
  });

  it("returns wordpress_unreachable and leaves the connection intact on a transient failure", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: { showcases: [draftShowcase()] },
      }),
    });
    const serviceClient = connectedServiceClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(serviceClient as never);
    // A 503 (and equally a network/timeout error) is transient — NOT a 401.
    vi.mocked(publishShowcasePost).mockRejectedValue(
      new WordPressError(503, "http_503", "Service Unavailable"),
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("wordpress_unreachable");
    // A transient failure must NEVER break the connection.
    const brokenFlip = serviceClient.__mutations.find(
      (m) => m.table === "website_connection" && m.op === "update",
    );
    expect(brokenFlip).toBeUndefined();
  });

  it("403s for a non-admin without touching WordPress", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-9" },
        tables: memberTables({
          userId: "user-9",
          role: "member",
          extraTables: { showcases: [draftShowcase()] },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(403);
    expect(publishShowcasePost).not.toHaveBeenCalled();
  });

  it("hot-links the Showcase's public photo URLs into the post body, in gallery order", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: {
            showcases: [draftShowcase({ photo_ids: ["p1", "p2"] })],
            // Rows come back in arbitrary order — the route must re-sequence them
            // to match photo_ids (gallery order is meaningful).
            photos: [
              { id: "p2", job_id: "job-1", storage_path: "job-1/two.jpg", annotated_path: null },
              { id: "p1", job_id: "job-1", storage_path: "job-1/one.jpg", annotated_path: null },
            ],
          },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );
    vi.mocked(publishShowcasePost).mockResolvedValue({
      id: "42",
      url: "https://example.com/projects/storm-roof",
    });

    await POST(publishRequest({ consent: true }), paramsFor("job-1", "sc-1"));

    const content = vi.mocked(publishShowcasePost).mock.calls[0][1];
    const oneUrl =
      "https://sb.test/storage/v1/object/public/photos/job-1/one.jpg";
    const twoUrl =
      "https://sb.test/storage/v1/object/public/photos/job-1/two.jpg";
    expect(content.bodyHtml).toContain(oneUrl);
    expect(content.bodyHtml).toContain(twoUrl);
    // p1 before p2 — the gallery order, not the row order.
    expect(content.bodyHtml.indexOf(oneUrl)).toBeLessThan(
      content.bodyHtml.indexOf(twoUrl),
    );
    expect(content.title).toBe("Storm-torn roof, made whole");
  });
});
