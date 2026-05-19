import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
} from "../../../__test-utils__/request-context-fakes";

function makeRequest(): Request {
  return new Request("http://test/api/contracts/by-job/job-1");
}

const paramsFor = { params: Promise.resolve({ jobId: "job-1" }) };

// Wires the User client the wrapper authenticates against. `jobOrgId` sets
// which Organization the seeded `job-1` belongs to (the #97 guard resolves
// the contract list's tenant scope through it); omit it for "job missing".
function mockCaller(opts: {
  user: { id: string } | null;
  role?: string;
  grants?: string[];
  jobOrgId?: string;
}) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue(
    fakeUserClient({
      user: opts.user,
      tables: opts.user
        ? memberTables({
            userId: opts.user.id,
            role: opts.role ?? "member",
            grants: opts.grants ?? [],
            extraTables: {
              jobs: opts.jobOrgId
                ? [{ id: "job-1", organization_id: opts.jobOrgId }]
                : [],
              contracts: [
                {
                  id: "c-1",
                  job_id: "job-1",
                  status: "sent",
                  created_at: "2026-05-13T10:00:00Z",
                },
              ],
            },
          })
        : undefined,
    }) as never,
  );
}

// #106 — by-job is a contracts read, gated on `view_jobs`, and the
// caller-supplied `jobId` is additionally run through the #97
// Active-Organization scoping guard.
describe("GET /api/contracts/by-job/[jobId] — permission gate + org scope (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no job permissions", async () => {
    mockCaller({ user: { id: "u1" }, grants: [], jobOrgId: "org-1" });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(403);
  });

  it("lists the job's contracts for a member holding view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"], jobOrgId: "org-1" });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  it("lists the job's contracts for an admin", async () => {
    mockCaller({ user: { id: "u1" }, role: "admin", jobOrgId: "org-1" });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  it("returns 404 when the job belongs to another Organization", async () => {
    mockCaller({
      user: { id: "u1" },
      grants: ["view_jobs"],
      jobOrgId: "org-OTHER",
    });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the job does not exist", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await GET(makeRequest(), paramsFor);
    expect(res.status).toBe(404);
  });
});
