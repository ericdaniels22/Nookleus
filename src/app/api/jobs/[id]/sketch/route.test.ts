// DELETE /api/jobs/[id]/sketch — delete a Job's whole Sketch (#869, S9). The
// "start over" action: the Sketch and everything it owns (Floors, Rooms, and —
// when they land — openings/objects) go through ON DELETE CASCADE, and the stored
// mesh goes with the row. These tests pin the route's wiring: the `edit_jobs`
// gate, the Job-visibility guard, resolving the Job's 1:1 Sketch server-side (the
// client never names the Sketch), and forwarding that Sketch's id to the delete
// step. The cascade + frozen-quantity-survives behavior is proven against a real
// database in tests/integration/sketch-deletion.pg.test.ts; the delete helper is
// mocked here.

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
vi.mock("@/lib/sketch/delete-sketch", () => ({
  deleteSketch: vi.fn(),
}));

import { DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { deleteSketch } from "@/lib/sketch/delete-sketch";
import {
  fakeUserClient,
  memberTables,
} from "../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function deleteReq() {
  return new Request("http://test", { method: "DELETE" });
}

// A caller who is a member with edit_jobs, for whom the URL's Job (`job-1`) is
// visible and carries a 1:1 Sketch (`sketch-1`) in their Organization.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        jobs: [{ id: "job-1", organization_id: "org-1" }],
        sketches: [
          { id: "sketch-1", job_id: "job-1", organization_id: "org-1" },
        ],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(deleteSketch).mockResolvedValue(undefined as never);
});

describe("DELETE /api/jobs/[id]/sketch", () => {
  it("deletes the Sketch (200) by resolving the Job's Sketch and forwarding its id", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1"));

    expect(res.status).toBe(200);
    expect(deleteSketch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sketchId: "sketch-1" }),
    );
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(deleteSketch).not.toHaveBeenCalled();
  });

  it("returns 404 without deleting when the Job is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `jobs` row: the Job is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(deleteSketch).not.toHaveBeenCalled();
  });

  it("returns 404 without deleting when the Job has no Sketch", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // Job visible, but no `sketches` row: nothing to delete.
          extraTables: {
            jobs: [{ id: "job-1", organization_id: "org-1" }],
          },
        }),
      }) as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(deleteSketch).not.toHaveBeenCalled();
  });
});
