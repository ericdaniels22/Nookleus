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
} from "../../../../../__test-utils__/request-context-fakes";

const paramsFor = { params: Promise.resolve({ id: "job-1", fileId: "f-1" }) };

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
                { id: "f-1", storage_path: "org-1/job-1/f-1.pdf" },
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

// #103 — the job-file signed-URL read requires `view_jobs`.
describe("GET /api/jobs/[id]/files/[fileId]/url (gated on view_jobs, #103)", () => {
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

  it("returns a signed URL for a member holding view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await GET(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain("signed.test");
  });
});
