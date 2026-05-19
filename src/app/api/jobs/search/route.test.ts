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

const seededJobs = {
  jobs: [
    { id: "job-1", job_number: "1001", property_address: "1 Main St" },
    { id: "job-2", job_number: "1002", property_address: "2 Oak Ave" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// Job search was previously ungated (RLS-only); #103 gates it on `view_jobs`.
describe("GET /api/jobs/search (gated on view_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );

    const res = await GET(new Request("http://test/api/jobs/search"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: [],
          extraTables: seededJobs,
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/jobs/search"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(403);
  });

  it("returns jobs for a member holding view_jobs", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["view_jobs"],
          extraTables: seededJobs,
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/jobs/search"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual([
      "job-1",
      "job-2",
    ]);
  });

  it("returns jobs for an admin without an explicit grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "admin",
          grants: [],
          extraTables: seededJobs,
        }),
      }) as never,
    );

    const res = await GET(new Request("http://test/api/jobs/search"), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(2);
  });
});
