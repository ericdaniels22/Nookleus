// POST /api/jobs/[id]/reports/[reportId]/restore — pull a Photo Report back out
// of the recoverable trash (#402). Pins the `edit_jobs` gate and that the
// handler clears `deleted_at`.

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

function paramsFor(id: string, reportId: string) {
  return { params: Promise.resolve({ id, reportId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("POST /api/jobs/[id]/reports/[reportId]/restore", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(403);
  });

  it("clears deleted_at for a caller holding edit_jobs", async () => {
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: {
          photo_reports: [
            { id: "r-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" },
          ],
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "photo_reports",
        op: "update",
        payload: { deleted_at: null },
      }),
    );
  });

  it("returns 404 when no trashed report matches the id and job", async () => {
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: { photo_reports: [] },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 (no-op) when the report is already active", async () => {
    // The row exists and matches id + job, but it is NOT trashed. The
    // `.not("deleted_at", "is", null)` guard must exclude it so restoring an
    // already-active report is a 404 no-op, not a needless write.
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: {
          photo_reports: [{ id: "r-1", job_id: "job-1", deleted_at: null }],
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(404);
  });

  it("returns 404 (a no-op) for a trashed report that belongs to a different Job", async () => {
    // The report is trashed (so the `.not("deleted_at", "is", null)` guard would
    // admit it on its own), but it lives under job-2. job-1's restore route must
    // not reach it: `.eq("job_id", jobId)` scopes the write to the report's own
    // Job, so a caller cannot revive another Job's report by id alone. Drop that
    // filter and the trashed row leaks through — 200 instead of 404.
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: {
          photo_reports: [
            { id: "r-1", job_id: "job-2", deleted_at: "2026-01-01T00:00:00Z" },
          ],
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(404);
  });

  it("returns 409 when restoring collides with an active report number", async () => {
    // Pre-existing duplicate left from before the partial unique index shipped:
    // restoring the trashed copy re-adds a second active row with the same
    // (job_id, report_number), which the index rejects (Postgres 23505). The
    // route must surface that as an actionable 409, not an opaque 500.
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: {
          photo_reports: [
            { id: "r-1", job_id: "job-1", deleted_at: "2026-01-01T00:00:00Z" },
          ],
        },
      }),
      errorsByTable: {
        photo_reports: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "photo_reports_job_report_number_key"',
        },
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await POST(new Request("http://test"), paramsFor("job-1", "r-1"));

    expect(res.status).toBe(409);
  });
});
