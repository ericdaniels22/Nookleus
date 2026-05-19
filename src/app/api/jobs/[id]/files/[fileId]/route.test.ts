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

import { PATCH, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

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
                { id: "f-1", filename: "old.pdf", storage_path: "org-1/job-1/f-1.pdf" },
              ],
            },
          })
        : undefined,
    }) as never,
  );
}

function patchRequest(body: unknown) {
  return new Request("http://test", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

// #103 — job file writes and deletes require `edit_jobs`.
describe("PATCH /api/jobs/[id]/files/[fileId] (gated on edit_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await PATCH(patchRequest({ filename: "new.pdf" }), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await PATCH(patchRequest({ filename: "new.pdf" }), paramsFor);
    expect(res.status).toBe(403);
  });

  it("renames the file for a member holding edit_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await PATCH(patchRequest({ filename: "new.pdf" }), paramsFor);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/jobs/[id]/files/[fileId] (gated on edit_jobs, #103)", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCaller({ user: null });
    const res = await DELETE(new Request("http://test"), paramsFor);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller holds only view_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["view_jobs"] });
    const res = await DELETE(new Request("http://test"), paramsFor);
    expect(res.status).toBe(403);
  });

  it("deletes the file for a member holding edit_jobs", async () => {
    mockCaller({ user: { id: "u1" }, grants: ["edit_jobs"] });
    const res = await DELETE(new Request("http://test"), paramsFor);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
