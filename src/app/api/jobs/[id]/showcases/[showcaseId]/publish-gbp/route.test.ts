// POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp — push a Showcase to
// the Organization's connected Google Business Profile as a local post (#609,
// PRD #603, ADR 0015). These tests pin the orchestration the route owns: the
// admin gate, the one-click consent gate, the publish-time privacy scrub (the
// SAME rules as website publishing, AC#4), the connection preconditions, the
// "one of its Photos" media requirement (AC#1), the create-vs-update hand-off,
// the DISTINCT failures (AC#5), and the per-channel publish-state stamp written
// back independently of the website channel (AC#3). The v4 local-posts client is
// unit-tested in src/lib/google/showcase-gbp-post.test.ts; here it is mocked so a
// route test never touches the network.

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
// The authorized Google client is mocked: the route never refreshes a token or
// touches the network. getGoogleConnection / deriveConnectionState / markBroken
// run for real against the fake service client (we seed google_connection rows
// and assert the broken-flip mutation).
vi.mock("@/lib/google/client", () => ({
  getGoogleClient: vi.fn(),
}));
// Keep the real location discovery shape but stub the network-touching walk.
vi.mock("@/lib/google/reviews", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/google/reviews")>();
  return { ...actual, listReviewLocations: vi.fn() };
});
// Keep the real error contract (GbpPublishError, isGbpAuthError) and the pure
// summarizer; stub only the network-touching publisher.
vi.mock("@/lib/google/showcase-gbp-post", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/google/showcase-gbp-post")>();
  return { ...actual, publishShowcaseGbpPost: vi.fn() };
});

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getGoogleClient } from "@/lib/google/client";
import { listReviewLocations } from "@/lib/google/reviews";
import {
  publishShowcaseGbpPost,
  GbpPublishError,
} from "@/lib/google/showcase-gbp-post";
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

// A service client carrying a healthy Google connection for the active org, so a
// test can reach the publish step. Override the row per test as needed.
function connectedServiceClient(overrides: Record<string, unknown> = {}) {
  return fakeServiceClient({
    tables: {
      google_connection: [
        {
          id: "gconn-1",
          organization_id: "org-1",
          google_account_email: "owner@example.com",
          google_account_name: "Example Owner",
          refresh_token_encrypted: "refresh",
          access_token_encrypted: "access",
          access_token_expires_at: "2099-01-01T00:00:00.000Z",
          scopes: ["https://www.googleapis.com/auth/business.manage"],
          status: "connected",
          broken_reason: null,
          broken_at: null,
          connected_by: "user-1",
          created_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2026-05-01T00:00:00.000Z",
          last_consented_at: "2026-06-25T00:00:00.000Z",
          ...overrides,
        },
      ],
    },
  });
}

// An authorized-client stub: the route only ever calls `.fetch` indirectly
// through the mocked deep modules, so an empty object typed as the client is
// enough to thread through.
function fakeGoogleClient() {
  return { organizationId: "org-1", accountEmail: "owner@example.com" };
}

// A draft Showcase with one photo and a write-up clean of customer PII, so a
// test can reach the publish step without tripping the scrub. Override per test.
function draftShowcase(overrides: Record<string, unknown> = {}) {
  return {
    id: "sc-1",
    organization_id: "org-1",
    job_id: "job-1",
    title: "Storm-torn roof, made whole",
    write_up: "We replaced the whole roof after the spring storms.",
    photo_ids: ["p1"],
    status: "draft",
    wordpress_post_id: null,
    wordpress_post_url: null,
    published_at: null,
    consent_confirmed_by: null,
    consent_confirmed_at: null,
    gbp_post_name: null,
    gbp_post_url: null,
    gbp_published_at: null,
    deleted_at: null,
    ...overrides,
  };
}

// One photo row for the Showcase's lead photo, so resolution yields a media URL.
function photoRows() {
  return [
    { id: "p1", job_id: "job-1", storage_path: "job-1/one.jpg", annotated_path: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
  // Default happy wiring; individual tests override.
  vi.mocked(getGoogleClient).mockResolvedValue(fakeGoogleClient() as never);
  vi.mocked(listReviewLocations).mockResolvedValue(["accounts/1/locations/2"]);
  vi.mocked(publishShowcaseGbpPost).mockResolvedValue({
    name: "accounts/1/locations/2/localPosts/9",
    url: "https://www.google.com/search?q=gbp-post",
  });
});

describe("POST /api/jobs/[id]/showcases/[showcaseId]/publish-gbp", () => {
  it("404s when the Showcase does not exist (nothing reaches Google)", async () => {
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
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("422s with consent_required when consent is missing or false (AC#4)", async () => {
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
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: false }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("consent_required");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("422s with privacy_scrub_blocked when the write-up still shows customer PII (AC#4)", async () => {
    // The GBP channel runs the SAME publish-time scrub as the website channel —
    // a Showcase whose copy still names the customer or their address never
    // reaches Google.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: {
            showcases: [
              draftShowcase({
                write_up:
                  "John Smith was thrilled with his new roof at 123 Main St.",
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
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("privacy_scrub_blocked");
    expect(body.violations).toEqual(
      expect.arrayContaining([
        { field: "customer_name", match: "John Smith" },
        { field: "address", match: "123 Main St" },
      ]),
    );
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("409s with not_connected when the Organization has no Google connection (AC#5)", async () => {
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
    // No google_connection row seeded — the connection does not exist.
    vi.mocked(createServiceClient).mockReturnValue(fakeServiceClient() as never);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("not_connected");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("409s with connection_broken when the Google connection row is broken (AC#5)", async () => {
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
      connectedServiceClient({
        status: "broken",
        broken_reason: "invalid_grant",
        broken_at: "2026-06-01T00:00:00.000Z",
      }) as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    // Distinct from not_connected — the card shows a reconnect prompt, not "set up".
    expect(body.code).toBe("connection_broken");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("422s with gbp_photo_required when the Showcase has no usable photo (AC#1)", async () => {
    // A Business Profile update shows ONE photo (AC#1 — "with one of its
    // Photos"). A Showcase with no resolvable photo can't be posted, and the
    // failure is surfaced distinctly before anything reaches Google.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: { showcases: [draftShowcase({ photo_ids: [] })] },
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
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("gbp_photo_required");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("409s with connection_broken when authorizing the Google client just failed (AC#5)", async () => {
    // The connection row reads connected, but getGoogleClient returns null — the
    // refresh token was just rejected (invalid_grant) and the chokepoint already
    // flipped the row broken. The route reports the same reconnect-prompt state.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: {
            showcases: [draftShowcase()],
            photos: photoRows(),
          },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );
    vi.mocked(getGoogleClient).mockResolvedValue(null);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("connection_broken");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("422s with gbp_no_location when the connected account manages no Business Profile (AC#5)", async () => {
    // The grant is healthy but the account has no location to post to (e.g. the
    // profile is still pending verification). Surface this distinctly rather than
    // letting the publish call fail opaquely.
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          extraTables: {
            showcases: [draftShowcase()],
            photos: photoRows(),
          },
        }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );
    vi.mocked(listReviewLocations).mockResolvedValue([]);

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("gbp_no_location");
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });

  it("creates a new local post with the lead photo and stamps the Showcase published (AC#1, AC#2)", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: {
          showcases: [draftShowcase()],
          photos: photoRows(),
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    // First publish → a CREATE: the publisher is handed a null existing post name.
    expect(publishShowcaseGbpPost).toHaveBeenCalledTimes(1);
    const call = vi.mocked(publishShowcaseGbpPost).mock.calls[0];
    // Posts to the resolved location, with the lead photo and a summary composed
    // from the title + write-up (AC#1 — one photo; AC#2 — content shaped to fit).
    expect(call[1]).toBe("accounts/1/locations/2");
    expect(call[2].photoUrl).toBe(
      "https://sb.test/storage/v1/object/public/photos/job-1/one.jpg",
    );
    expect(call[2].summary).toContain("Storm-torn roof, made whole");
    expect(call[2].summary).toContain("replaced the whole roof");
    expect(call[3]).toBeNull();

    // The Showcase is stamped on the GBP channel with the remote post name + URL
    // and the one-click consent audit (who + when).
    const update = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(update?.payload).toMatchObject({
      gbp_post_name: "accounts/1/locations/2/localPosts/9",
      gbp_post_url: "https://www.google.com/search?q=gbp-post",
      consent_confirmed_by: "user-1",
    });
    const payload = update?.payload as Record<string, unknown>;
    expect(typeof payload.gbp_published_at).toBe("string");
    expect(typeof payload.consent_confirmed_at).toBe("string");

    // The response reflects the now-live Business Profile post for the UI.
    expect(body.state).toBe("published");
    expect(body.liveUrl).toBe("https://www.google.com/search?q=gbp-post");
  });

  it("re-pushes the SAME local post on edit and leaves the website channel untouched (AC#3)", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-2" },
      tables: memberTables({
        userId: "user-2",
        role: "admin",
        extraTables: {
          showcases: [
            // Already live on the Business Profile, but still a WEBSITE draft —
            // the two channels are independent.
            draftShowcase({
              status: "draft",
              wordpress_post_id: null,
              wordpress_post_url: null,
              published_at: null,
              gbp_post_name: "accounts/1/locations/2/localPosts/9",
              gbp_post_url: "https://www.google.com/search?q=gbp-post",
              gbp_published_at: "2026-06-01T00:00:00.000Z",
            }),
          ],
          photos: photoRows(),
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(
      connectedServiceClient() as never,
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    // The recorded post name is handed back to the publisher → UPDATE the same
    // post, never stack a duplicate onto the profile.
    expect(vi.mocked(publishShowcaseGbpPost).mock.calls[0][3]).toBe(
      "accounts/1/locations/2/localPosts/9",
    );

    const update = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    // Re-affirming consent re-stamps the latest who.
    expect(update?.payload).toMatchObject({ consent_confirmed_by: "user-2" });
    // INDEPENDENCE: the GBP publish must never touch the website channel columns.
    const payload = update?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("wordpress_post_id");
    expect(payload).not.toHaveProperty("wordpress_post_url");
    expect(payload).not.toHaveProperty("published_at");
  });

  it("marks the connection broken and returns gbp_permission_denied on a 403 (AC#5)", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: {
          showcases: [draftShowcase()],
          photos: photoRows(),
        },
      }),
    });
    const serviceClient = connectedServiceClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(serviceClient as never);
    // 403 PERMISSION_DENIED — the connected account can't manage this profile.
    // Unlike a WordPress 401-only signal, a 403 also breaks the GBP connection.
    vi.mocked(publishShowcaseGbpPost).mockRejectedValue(
      new GbpPublishError(403, "PERMISSION_DENIED", "The caller does not have permission"),
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("gbp_permission_denied");
    // A 401/403 is the revoked signal: flip the connection broken so the card
    // prompts a reconnect.
    const brokenFlip = serviceClient.__mutations.find(
      (m) => m.table === "google_connection" && m.op === "update",
    );
    expect(brokenFlip?.payload).toMatchObject({ status: "broken" });
    // Nothing was published, so the Showcase must NOT be stamped on the GBP channel.
    const stamp = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(stamp).toBeUndefined();
  });

  it("returns gbp_unreachable and leaves the connection intact on a transient failure (AC#5)", async () => {
    const userClient = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "admin",
        extraTables: {
          showcases: [draftShowcase()],
          photos: photoRows(),
        },
      }),
    });
    const serviceClient = connectedServiceClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(userClient as never);
    vi.mocked(createServiceClient).mockReturnValue(serviceClient as never);
    // A 503 (and equally a network/timeout error) is transient — NOT a 401/403.
    vi.mocked(publishShowcaseGbpPost).mockRejectedValue(
      new GbpPublishError(503, "http_503", "Service Unavailable"),
    );

    const res = await POST(
      publishRequest({ consent: true }),
      paramsFor("job-1", "sc-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("gbp_unreachable");
    // A transient failure must NEVER break the connection.
    const brokenFlip = serviceClient.__mutations.find(
      (m) => m.table === "google_connection" && m.op === "update",
    );
    expect(brokenFlip).toBeUndefined();
    // And it must NOT stamp the Showcase published.
    const stamp = userClient.__mutations.find(
      (m) => m.table === "showcases" && m.op === "update",
    );
    expect(stamp).toBeUndefined();
  });

  it("403s for a non-admin without touching Google (AC#4)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-9" },
        tables: memberTables({
          userId: "user-9",
          role: "member",
          extraTables: {
            showcases: [draftShowcase()],
            photos: photoRows(),
          },
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
    expect(publishShowcaseGbpPost).not.toHaveBeenCalled();
  });
});
