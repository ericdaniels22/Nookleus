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

import { GET, POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

const paramsFor = { params: Promise.resolve({ id: "job-1" }) };

function mockCaller(opts: {
  user: { id: string } | null;
  role?: string;
  grants?: string[];
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
              job_files: [
                { id: "f-1", organization_id: "org-1", job_id: "job-1" },
                { id: "f-2", organization_id: "org-1", job_id: "job-1" },
              ],
            },
          })
        : undefined,
    }) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #103 — job file reads require `view_jobs`, writes require `edit_jobs`.
describe("GET /api/jobs/[id]/files (gated on view_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: [] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(403);
  });

  it("lists the job's files for a member holding view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((f: { id: string }) => f.id)).toEqual(["f-1", "f-2"]);
  });

  it("lists the job's files for an admin without an explicit grant", async () => {
    mockCaller({ user: { id: "u1" }, role: "admin", grants: [] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/jobs/[id]/files (gated on edit_jobs, #103)", () => {
  function uploadRequest() {
    return new Request("http://test", { method: "POST", body: new FormData() });
  }

  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await POST(uploadRequest(), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await POST(uploadRequest(), paramsFor);
    expect(res.status).toBe(403);
  });

  it("admits a member holding edit_jobs (body runs — 400 on an empty upload)", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await POST(uploadRequest(), paramsFor);
    expect(res.status).toBe(400);
  });
});
