// PATCH / DELETE /api/jobs/[id]/sketch/rooms/[roomId] — mutate or remove a placed
// Room from the full-screen editor (#890). These tests pin the route's wiring:
// the `edit_jobs` gate, the Room-visibility guard (a caller can't touch a Room
// their org can't see — the RLS-scoped read resolves to no row, 404), payload
// validation, and forwarding the recognized fields to the write step. The move
// math + measurement recompute is covered in src/lib/sketch/update-room.test.ts
// and the delete in delete-room.test.ts, so both helpers are mocked here.

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
vi.mock("@/lib/sketch/update-room", () => ({
  updateSketchRoom: vi.fn(),
}));
vi.mock("@/lib/sketch/delete-room", () => ({
  deleteSketchRoom: vi.fn(),
}));

import { PATCH, DELETE } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { updateSketchRoom } from "@/lib/sketch/update-room";
import { deleteSketchRoom } from "@/lib/sketch/delete-room";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, roomId: string) {
  return { params: Promise.resolve({ id, roomId }) };
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

// A caller who is a member with edit_jobs and for whom the URL's Room (`room-1`)
// is visible in their Organization.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        rooms: [{ id: "room-1", organization_id: "org-1" }],
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(updateSketchRoom).mockResolvedValue({ id: "room-1" } as never);
  vi.mocked(deleteSketchRoom).mockResolvedValue(undefined as never);
});

describe("PATCH /api/jobs/[id]/sketch/rooms/[roomId]", () => {
  it("moves the Room (200) by forwarding the new origin to the update step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ origin: { x: 5, y: 7 } }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomId: "room-1", origin: { x: 5, y: 7 } }),
    );
  });

  it("forwards a rename and a ceiling-height override to the update step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ name: "  Primary Bedroom  ", ceilingHeightOverride: 10 }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        roomId: "room-1",
        name: "Primary Bedroom", // trimmed
        ceilingHeightOverride: 10,
      }),
    );
  });

  it("forwards an explicit null to clear the ceiling-height override", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    await PATCH(
      patchBody({ ceilingHeightOverride: null }),
      paramsFor("job-1", "room-1"),
    );

    expect(updateSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ceilingHeightOverride: null }),
    );
  });

  it("forwards a reshaped footprint to the update step (#862)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    // A reworked footprint arrives in placed floor coordinates; the update step
    // re-normalizes and recomputes (covered in update-room.test.ts). Here we pin
    // that the route accepts a ≥3-corner footprint and forwards it verbatim.
    const footprint = [
      { x: 2, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 9 },
      { x: 2, y: 9 },
    ];
    const res = await PATCH(
      patchBody({ footprint }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomId: "room-1", footprint }),
    );
  });

  it("forwards a doors/windows openings array to the update step (#866)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    // The 2D editor sends the Room's full opening list on every add/edit/remove;
    // the route forwards it verbatim to the write step, which recomputes net wall
    // area and the door/window counts (covered in update-room.test.ts).
    const openings = [
      { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
      { type: "window", width: 3, height: 4, wall_index: 1, offset: 2 },
    ];
    const res = await PATCH(
      patchBody({ openings }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(200);
    expect(updateSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomId: "room-1", openings }),
    );
  });

  it("returns 400 for an opening with a non-finite dimension (#866)", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({
        openings: [
          { type: "door", width: "wide", height: 7, wall_index: 0, offset: 1 },
        ],
      }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 400 for a footprint with fewer than three corners", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ footprint: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 400 for a footprint corner with a non-finite coordinate", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({
        footprint: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: "nope" },
        ],
      }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await PATCH(
      patchBody({ origin: { x: 5, y: 7 } }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(403);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 404 without updating when the Room is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `rooms` row: the Room is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await PATCH(
      patchBody({ origin: { x: 5, y: 7 } }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(404);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed origin", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await PATCH(
      patchBody({ origin: { x: "nope", y: 7 } }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(updateSketchRoom).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/jobs/[id]/sketch/rooms/[roomId]", () => {
  it("removes the Room (200) by forwarding its id to the delete step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1"));

    expect(res.status).toBe(200);
    expect(deleteSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ roomId: "room-1" }),
    );
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1"));

    expect(res.status).toBe(403);
    expect(deleteSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 404 without deleting when the Room is not visible to the caller's org", async () => {
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

    const res = await DELETE(deleteReq(), paramsFor("job-1", "room-1"));

    expect(res.status).toBe(404);
    expect(deleteSketchRoom).not.toHaveBeenCalled();
  });
});
