// POST /api/jobs/[id]/reports/[reportId]/delete — soft-delete a Photo Report
// into the recoverable trash (#402). These tests pin the `edit_jobs` gate
// (same as the report create route) and that the handler stamps `deleted_at`.

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

describe("POST /api/jobs/[id]/reports/[reportId]/delete", () => {
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

  it("stamps deleted_at for a caller holding edit_jobs", async () => {
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

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.__mutations).toContainEqual(
      expect.objectContaining({
        table: "photo_reports",
        op: "update",
        payload: { deleted_at: expect.any(String) },
      }),
    );
  });

  it("returns 404 when no active report matches the id and job", async () => {
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

  it("returns 404 (not a re-stamp) when the report is already trashed", async () => {
    // The row exists and matches id + job, but it is already soft-deleted. The
    // `.is("deleted_at", null)` guard must exclude it so a re-delete is a 404,
    // never a second `deleted_at` stamp.
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

    expect(res.status).toBe(404);
  });
});
