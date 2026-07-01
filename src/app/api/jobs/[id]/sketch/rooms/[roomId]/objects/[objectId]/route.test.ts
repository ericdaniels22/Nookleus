// PATCH / DELETE /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId] — mutate
// or remove a placed object from the full-screen editor (#867, S7). These tests
// pin the route's wiring: the `edit_jobs` gate, the object-visibility guard (a
// caller can't touch an object their org can't see — the RLS-scoped read resolves
// to no row, 404), payload validation, and forwarding the recognized fields to
// the write step. The patch semantics + category CHECK are covered in
// src/lib/sketch/update-object.test.ts and the delete in delete-object.test.ts,
// so both helpers are mocked here.

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
vi.mock("@/lib/sketch/update-object", () => ({
  updateSketchObject: vi.fn(),
}));
vi.mock("@/lib/sketch/delete-object", () => ({
  deleteSketchObject: vi.fn(),
}));

import { PATCH, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { updateSketchObject } from "@/lib/sketch/update-object";
import { deleteSketchObject } from "@/lib/sketch/delete-object";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, roomId: string, objectId: string) {
  return { params: Promise.resolve({ id, roomId, objectId }) };
}

function patchBody(body: unknown) {
  return new Request("http://test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteReq() {
  return new Request("http://test", { method: "DELETE" });
}

// A caller who is a member with edit_jobs and for whom the URL's object (`obj-1`)
// is visible in their Organization.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        room_objects: [{ id: "obj-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(updateSketchObject).mockResolvedValue({ id: "obj-1" } as never);
  vi.mocked(deleteSketchObject).mockResolvedValue(undefined as never);
});

describe("PATCH /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId]", () => {
  it("moves an object (200) by forwarding the new position to the update step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ position: { x: 4, y: 1.5 } }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ objectId: "obj-1", position: { x: 4, y: 1.5 } }),
    );
  });

  it("forwards a rotation and a category swap to the update step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ rotation: 45, category: "stove" }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ objectId: "obj-1", rotation: 45, category: "stove" }),
    );
  });

  it("returns 400 without updating for an unknown category", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ category: "spaceship" }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchObject).not.toHaveBeenCalled();
  });

  it("returns 400 without updating for a malformed position", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ position: { x: 4, y: "nope" } }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchObject).not.toHaveBeenCalled();
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await PATCH(
      patchBody({ position: { x: 4, y: 1.5 } }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(403);
    expect(updateSketchObject).not.toHaveBeenCalled();
  });

  it("returns 404 without updating when the object is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `room_objects` row: the object is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await PATCH(
      patchBody({ position: { x: 4, y: 1.5 } }),
      paramsFor("job-1", "room-1", "obj-1"),
    );

    expect(res.status).toBe(404);
    expect(updateSketchObject).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/jobs/[id]/sketch/rooms/[roomId]/objects/[objectId]", () => {
  it("removes an object (200) by forwarding its id to the delete step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1", "obj-1"));

    expect(res.status).toBe(200);
    expect(deleteSketchObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ objectId: "obj-1" }),
    );
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1", "obj-1"));

    expect(res.status).toBe(403);
    expect(deleteSketchObject).not.toHaveBeenCalled();
  });

  it("returns 404 without deleting when the object is not visible to the caller's org", async () => {
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

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1", "obj-1"));

    expect(res.status).toBe(404);
    expect(deleteSketchObject).not.toHaveBeenCalled();
  });
});
