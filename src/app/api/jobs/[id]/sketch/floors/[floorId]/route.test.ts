// PATCH /api/jobs/[id]/sketch/floors/[floorId] — rename a Floor (#865). These
// tests pin the route's wiring: the `edit_jobs` gate, the Floor-visibility guard
// (a caller can't rename a Floor their org can't see), name validation, and
// forwarding the new name to the update step. The update itself is covered in
// src/lib/sketch/update-floor.test.ts, so `updateFloor` is mocked here.

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
vi.mock("@/lib/sketch/update-floor", () => ({
  updateFloor: vi.fn(),
}));

import { PATCH } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { updateFloor } from "@/lib/sketch/update-floor";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, floorId: string) {
  return { params: Promise.resolve({ id, floorId }) };
}

function patchBody(body: unknown) {
  return new Request("http://test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A member with edit_jobs for whom the URL's Floor (`floor-1`) is visible.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        floors: [{ id: "floor-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(updateFloor).mockResolvedValue({ id: "floor-1", name: "Main House" } as never);
});

describe("PATCH /api/jobs/[id]/sketch/floors/[floorId]", () => {
  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await PATCH(patchBody({ name: "Main House" }), paramsFor("job-1", "floor-1"));

    expect(res.status).toBe(403);
    expect(updateFloor).not.toHaveBeenCalled();
  });

  it("returns 404 without renaming when the Floor is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `floors` row: the Floor is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await PATCH(patchBody({ name: "Main House" }), paramsFor("job-1", "floor-1"));

    expect(res.status).toBe(404);
    expect(updateFloor).not.toHaveBeenCalled();
  });

  it("returns 400 without renaming when the name is blank", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(authedClient() as never);

    const res = await PATCH(patchBody({ name: "   " }), paramsFor("job-1", "floor-1"));

    expect(res.status).toBe(400);
    expect(updateFloor).not.toHaveBeenCalled();
  });

  it("renames the Floor (200), forwarding the trimmed name to the update step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(authedClient() as never);

    const res = await PATCH(patchBody({ name: "  Main House  " }), paramsFor("job-1", "floor-1"));

    expect(res.status).toBe(200);
    expect(updateFloor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ floorId: "floor-1", name: "Main House" }),
    );
  });
});
