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

import { GET } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeClient,
  memberTables,
} from "@/lib/request-context/__test-utils__/request-context-fakes";

const noParams = { params: Promise.resolve({}) };
function req(): Request {
  return new Request("http://test/api/time/clockable-jobs", { method: "GET" });
}

function useUser(opts: Parameters<typeof fakeClient>[0]) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(fakeClient(opts) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// issue #701 — the active-Job picker loads the Jobs a worker can clock into
// (Active jobs: not completed, not cancelled, not trashed) plus the worker's
// recently-clocked Job ids so it can surface them first. Filtering/ranking by
// the typed query happens client-side via rankPickerJobs.
describe("GET /api/time/clockable-jobs (#701)", () => {
  it("returns Active Jobs (with customer) and the worker's recently-clocked ids", async () => {
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        jobs: [
          { id: "job-a", organization_id: "org-1", job_number: "J-1", property_address: "12 Maple St", status: "in_progress", deleted_at: null, contact: { full_name: "Ada Lovelace" } },
          { id: "job-b", organization_id: "org-1", job_number: "J-2", property_address: "9 Oak Ave", status: "scheduled", deleted_at: null, contact: null },
          { id: "job-done", organization_id: "org-1", job_number: "J-3", property_address: "1 Done Rd", status: "completed", deleted_at: null, contact: null },
          { id: "job-cancelled", organization_id: "org-1", job_number: "J-4", property_address: "2 Gone Rd", status: "cancelled", deleted_at: null, contact: null },
          { id: "job-trashed", organization_id: "org-1", job_number: "J-5", property_address: "3 Trash Ln", status: "in_progress", deleted_at: "2026-06-01T00:00:00Z", contact: null },
        ],
        // Seeded most-recent-first (the fake ignores .order); the route dedupes
        // preserving first occurrence, so the older job-a row collapses away.
        time_sessions: [
          { job_id: "job-b", user_id: "u-1", organization_id: "org-1", deleted_at: null },
          { job_id: "job-a", user_id: "u-1", organization_id: "org-1", deleted_at: null },
          { job_id: "job-b", user_id: "u-1", organization_id: "org-1", deleted_at: null },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req(), noParams);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Only the two Active Jobs survive; completed / cancelled / trashed are out.
    expect(body.jobs.map((j: { id: string }) => j.id).sort()).toEqual(["job-a", "job-b"]);
    const jobA = body.jobs.find((j: { id: string }) => j.id === "job-a");
    expect(jobA).toEqual({
      id: "job-a",
      job_number: "J-1",
      property_address: "12 Maple St",
      contact: { full_name: "Ada Lovelace" },
    });
    expect(body.recentJobIds).toEqual(["job-b", "job-a"]);
  });

  it("normalizes a one-element array contact embed to a single object", async () => {
    // PostgREST can surface a to-one embed as a one-element array; the picker
    // expects a single { full_name } (or null).
    const client = fakeClient({
      user: { id: "u-1" },
      tables: {
        ...memberTables({ userId: "u-1", role: "crew_member", grants: ["track_time"] }),
        jobs: [
          { id: "job-a", organization_id: "org-1", job_number: "J-1", property_address: "12 Maple St", status: "in_progress", deleted_at: null, contact: [{ full_name: "Ada Lovelace" }] },
        ],
      },
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(req(), noParams);
    const body = await res.json();
    expect(body.jobs[0].contact).toEqual({ full_name: "Ada Lovelace" });
  });

  it("returns 401 when unauthenticated", async () => {
    useUser({ user: null });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks track_time", async () => {
    useUser({
      user: { id: "u-1" },
      tables: memberTables({ userId: "u-1", role: "crew_member", grants: [] }),
    });
    const res = await GET(req(), noParams);
    expect(res.status).toBe(403);
  });
});
