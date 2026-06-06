// PUT /api/jobs/[id]/reports/[reportId] — keepalive-capable content write path
// for the Photo Report builder (#478). Lets a pending autosave edit flush during
// a hard page-unload (tab close / refresh / app-background) via a plain
// `keepalive: true` PUT, instead of the Supabase JS client (which can't ride a
// keepalive request and won't survive page teardown). Persists title /
// report_date / sections with the same `edit_jobs` gate and (id, job_id, active)
// tenancy scoping as the delete/restore siblings — server-side, never relying on
// client-assembled auth. The builder trigger that fires this lives in #479.

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

function paramsFor(id: string, reportId: string) {
  return { params: Promise.resolve({ id, reportId }) };
}

function putRequest(body: unknown) {
  return new Request("http://test", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("PUT /api/jobs/[id]/reports/[reportId]", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await PUT(
      putRequest({ title: "x", report_date: "2026-06-06", sections: [] }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await PUT(
      putRequest({ title: "x", report_date: "2026-06-06", sections: [] }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(403);
  });

  it("persists title/report_date/sections for a caller holding edit_jobs", async () => {
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

    const res = await PUT(
      putRequest({
        title: "Roof Inspection",
        report_date: "2026-06-06",
        sections: [{ id: "s-1" }],
      }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "photo_reports",
        op: "update",
        payload: {
          title: "Roof Inspection",
          report_date: "2026-06-06",
          sections: [{ id: "s-1" }],
        },
      }),
    );
  });

  it("rejects a cross-tenant write (report reached through the wrong Job) with 404", async () => {
    // The report exists, but it belongs to a different Job — a caller must not be
    // able to write to it by guessing its id through their own Job. The
    // `.eq("job_id", jobId)` scoping (RLS in prod) excludes it, so the write
    // matches no active row and 404s rather than silently editing another
    // tenant's report.
    const client = fakeUserClient({
      user: { id: "user-1" },
      tables: memberTables({
        userId: "user-1",
        role: "member",
        grants: ["edit_jobs"],
        extraTables: {
          photo_reports: [{ id: "r-1", job_id: "other-job", deleted_at: null }],
        },
      }),
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putRequest({ title: "x", report_date: "2026-06-06", sections: [] }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when the report is trashed (a soft-deleted report is not editable)", async () => {
    // A late flush must not resurrect content onto a report the user already
    // trashed. The `.is("deleted_at", null)` guard excludes soft-deleted rows, so
    // the write matches nothing and 404s.
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

    const res = await PUT(
      putRequest({ title: "x", report_date: "2026-06-06", sections: [] }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(404);
  });

  it("surfaces a DB write error as a 500, not a false success", async () => {
    // If the UPDATE itself errors, the route must not 404 (which would read as
    // "report gone") or 200 (a false flush). `.maybeSingle()` returns the error
    // and the route routes it through apiDbError → 500.
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
      errorsByTable: {
        photo_reports: { message: "connection reset" },
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await PUT(
      putRequest({ title: "x", report_date: "2026-06-06", sections: [] }),
      paramsFor("job-1", "r-1"),
    );

    expect(res.status).toBe(500);
  });
});
