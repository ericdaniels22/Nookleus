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
import { createServiceClient } from "@/lib/supabase-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  fakeServiceClient,
  memberTables,
} from "../../__test-utils__/request-context-fakes";

function paramsFor(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

describe("GET /api/expenses/by-job/[jobId] (converted to withRequestContext)", () => {
  it("returns 401 when unauthenticated — no permission required, but logged-in is", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({ user: null }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({}).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(401);
  });

  it("returns the job's expenses for any logged-in caller, even one with no permission grants", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );
    vi.mocked(createServiceClient).mockReturnValue(
      fakeServiceClient({
        tables: {
          expenses: [
            { id: "exp-1", job_id: "job-1" },
            { id: "exp-2", job_id: "job-1" },
            { id: "exp-3", job_id: "job-2" },
          ],
        },
      }).client as never,
    );

    const res = await GET(new Request("http://test"), paramsFor("job-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.map((e: { id: string }) => e.id)).toEqual(["exp-1", "exp-2"]);
  });
});
