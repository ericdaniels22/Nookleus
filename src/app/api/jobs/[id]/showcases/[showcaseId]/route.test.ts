// PUT /api/jobs/[id]/showcases/[showcaseId] — autosave the Showcase builder
// (#613). These tests pin the admin-only gate, the (id, job_id, active) tenancy
// scoping, the whitelist of editable columns, and that photo_ids is re-run
// through the ownership gate on write (a public gallery must never leak another
// Job's photo).

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

import { PUT } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, showcaseId: string) {
  return { params: Promise.resolve({ id, showcaseId }) };
}

function putBody(body: unknown) {
  return new Request("http://test", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// An admin of the active org whose Job holds a live Showcase `sc-1`.
function adminClient(extra: Record<string, unknown[]> = {}) {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "admin",
      extraTables: {
        showcases: [{ id: "sc-1", job_id: "job-1", deleted_at: null }],
        ...extra,
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PUT /api/jobs/[id]/showcases/[showcaseId]", () => {
  it("autosaves the title and write-up for an admin", async () => {
    const client = adminClient();
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putBody({ title: "Kitchen remodel", write_up: "A full gut reno." }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "showcases",
        op: "update",
        payload: { title: "Kitchen remodel", write_up: "A full gut reno." },
      }),
    );
  });

  it("returns 403 for a non-admin member, even one holding edit_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
        }),
      }) as never,
    );

    const res = await PUT(
      putBody({ title: "x" }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when no live Showcase matches the id and Job", async () => {
    // The Showcase exists but is trashed (deleted_at set): `.is("deleted_at",
    // null)` must exclude it so an autosave to a trashed row is a 404, never a
    // silent resurrection-by-edit.
    const client = adminClient({
      showcases: [
        { id: "sc-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putBody({ title: "x" }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 (a no-op) for a Showcase that belongs to a different Job", async () => {
    // The Showcase is live but lives under job-2. job-1's autosave must not reach
    // it: `.eq("job_id", jobId)` scopes the write to the Showcase's own Job.
    const client = adminClient({
      showcases: [{ id: "sc-1", job_id: "job-2", deleted_at: null }],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putBody({ title: "x" }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });

  it("drops foreign photo ids on autosave, keeping only the Job's own in order", async () => {
    // The builder sent p1, p2, p3 but only p1 and p3 belong to this Job. The
    // autosave must re-run the ownership gate so the stored gallery never holds
    // another Job's photo — the public-gallery privacy guarantee.
    const client = adminClient({
      photos: [
        { id: "p1", job_id: "job-1" },
        { id: "p3", job_id: "job-1" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putBody({ photo_ids: ["p1", "p2", "p3"] }),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "showcases",
        op: "update",
        payload: { photo_ids: ["p1", "p3"] },
      }),
    );
  });
});
