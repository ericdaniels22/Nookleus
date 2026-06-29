// GET /api/marketing/showcases — the Marketing area's Showcases tab data (#613).
// Returns the Org's live Showcases plus the "nudge" list: recently-completed
// Jobs that still have no Showcase. Admin-only, like every Showcase surface.
//
// These tests pin the admin gate and the nudge wiring: a freshly-completed Job
// with no Showcase is nudged, an already-showcased Job is not, a Job whose only
// Showcase was trashed reappears, and a long-ago-completed Job ages out.

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
  fakeUserClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function adminClient(extraTables: Record<string, Record<string, unknown>[]>) {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({ userId: "user-1", role: "admin", extraTables }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/marketing/showcases", () => {
  it("returns the live showcases and nudges a recently-completed Job with none", async () => {
    const client = adminClient({
      showcases: [{ id: "sc-1", job_id: "job-1", deleted_at: null }],
      jobs: [
        { id: "job-1", status: "completed", updated_at: daysAgo(2), job_number: "J-1" },
        { id: "job-2", status: "completed", updated_at: daysAgo(3), job_number: "J-2" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(new Request("http://test"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.showcases).toHaveLength(1);
    expect(body.showcases[0].id).toBe("sc-1");
    // job-2 (completed, no showcase) is nudged; job-1 (already showcased) is not.
    expect(body.nudges.map((j: { id: string }) => j.id)).toEqual(["job-2"]);
  });

  it("ages a long-ago-completed Job out of the nudge window", async () => {
    const client = adminClient({
      showcases: [],
      jobs: [
        { id: "job-recent", status: "completed", updated_at: daysAgo(10), job_number: "J-R" },
        { id: "job-stale", status: "completed", updated_at: daysAgo(120), job_number: "J-S" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(new Request("http://test"), { params: Promise.resolve({}) });
    const body = await res.json();

    // The 120-days-ago Job is past the 90-day window; only the recent one nudges.
    expect(body.nudges.map((j: { id: string }) => j.id)).toEqual(["job-recent"]);
  });

  it("re-nudges a Job whose only Showcase was trashed", async () => {
    const client = adminClient({
      // The Showcase exists but is trashed, so the live-only query drops it and
      // its Job is no longer counted as showcased.
      showcases: [{ id: "sc-old", job_id: "job-1", deleted_at: daysAgo(1) }],
      jobs: [
        { id: "job-1", status: "completed", updated_at: daysAgo(2), job_number: "J-1" },
      ],
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);

    const res = await GET(new Request("http://test"), { params: Promise.resolve({}) });
    const body = await res.json();

    expect(body.showcases).toHaveLength(0);
    expect(body.nudges.map((j: { id: string }) => j.id)).toEqual(["job-1"]);
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

    const res = await GET(new Request("http://test"), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
  });
});
