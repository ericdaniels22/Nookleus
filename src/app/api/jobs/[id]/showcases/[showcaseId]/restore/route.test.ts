// POST /api/jobs/[id]/showcases/[showcaseId]/restore — pull a Showcase back out
// of the trash (#613). Clears deleted_at so the row returns to the live set.
// Admin-only, idempotent for an already-live row, and — because restoring
// re-enters the live set — it can collide with the one-live-per-Job index when
// the Job has since gained a new Showcase; that surfaces as a 409, not a 500.

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

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, showcaseId: string) {
  return { params: Promise.resolve({ id, showcaseId }) };
}

function adminClient(
  showcases: Record<string, unknown>[],
  errorsByTable?: Record<string, { code?: string; message: string }>,
) {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "admin",
      extraTables: { showcases },
    }),
    errorsByTable,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/jobs/[id]/showcases/[showcaseId]/restore", () => {
  it("clears deleted_at for an admin restoring a trashed Showcase", async () => {
    const client = adminClient([
      { id: "sc-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "showcases",
        op: "update",
        payload: { deleted_at: null },
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

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 (a no-op) when the Showcase is already live — nothing to restore", async () => {
    // `.not("deleted_at", "is", null)` excludes live rows, so restoring an
    // already-restored Showcase matches no trashed row and 404s rather than
    // re-stamping it.
    const client = adminClient([
      { id: "sc-1", job_id: "job-1", deleted_at: null },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 (a no-op) for a trashed Showcase that belongs to a different Job", async () => {
    const client = adminClient([
      { id: "sc-1", job_id: "job-2", deleted_at: "2026-01-01T00:00:00Z" },
    ]);
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 409 when restoring would collide with the Job's new live Showcase", async () => {
    // The admin trashed this Showcase, started a fresh one for the same Job,
    // then tried to restore the original — the one-live-per-Job partial unique
    // index rejects the update. That's an actionable conflict (delete the new
    // one first), not an opaque 500.
    const client = adminClient(
      [{ id: "sc-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" }],
      {
        showcases: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "showcases_one_live_per_job"',
        },
      },
    );
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(
      new Request("http://test"),
      paramsFor("job-1", "sc-1"),
    );

    expect(res.status).toBe(409);
  });
});
