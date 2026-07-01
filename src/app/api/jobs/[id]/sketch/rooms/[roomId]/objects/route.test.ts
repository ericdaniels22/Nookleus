// POST /api/jobs/[id]/sketch/rooms/[roomId]/objects — add a known object to a
// Room from the full-screen editor (#867, S7). These tests pin the route's
// wiring: the `edit_jobs` gate, the Room-visibility guard (a caller can't add to
// a Room their org can't see — the RLS-scoped read resolves to no row, 404),
// payload validation (a known category is required; position/rotation optional),
// and forwarding the recognized fields to the write step. The insert + category
// CHECK are covered in src/lib/sketch/create-object.test.ts and the pg test, so
// the writer is mocked here.

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
vi.mock("@/lib/sketch/create-object", () => ({
  createSketchObject: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { createSketchObject } from "@/lib/sketch/create-object";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string, roomId: string) {
  return { params: Promise.resolve({ id, roomId }) };
}

function postBody(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  vi.mocked(createSketchObject).mockResolvedValue({ id: "obj-1" } as never);
});

describe("POST /api/jobs/[id]/sketch/rooms/[roomId]/objects", () => {
  it("creates an object (201) by forwarding the category to the write step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ category: "refrigerator" }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(201);
    expect(createSketchObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        roomId: "room-1",
        category: "refrigerator",
      }),
    );
  });

  it("forwards a given position and rotation to the write step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ category: "stove", position: { x: 3.5, y: 2 }, rotation: 90 }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(201);
    expect(createSketchObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        category: "stove",
        position: { x: 3.5, y: 2 },
        rotation: 90,
      }),
    );
  });

  it("returns 400 without writing for an unknown category", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ category: "spaceship" }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(createSketchObject).not.toHaveBeenCalled();
  });

  it("returns 400 without writing when no category is given", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(postBody({}), paramsFor("job-1", "room-1"));

    expect(res.status).toBe(400);
    expect(createSketchObject).not.toHaveBeenCalled();
  });

  it("returns 400 without writing for a malformed position", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ category: "sink", position: { x: "nope", y: 2 } }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(400);
    expect(createSketchObject).not.toHaveBeenCalled();
  });

  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(
      postBody({ category: "refrigerator" }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(403);
    expect(createSketchObject).not.toHaveBeenCalled();
  });

  it("returns 404 without writing when the Room is not visible to the caller's org", async () => {
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

    const res = await POST(
      postBody({ category: "refrigerator" }),
      paramsFor("job-1", "room-1"),
    );

    expect(res.status).toBe(404);
    expect(createSketchObject).not.toHaveBeenCalled();
  });
});
