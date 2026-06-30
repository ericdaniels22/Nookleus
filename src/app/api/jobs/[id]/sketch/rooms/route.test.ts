// POST /api/jobs/[id]/sketch/rooms — add a rectangular Room to a Job's Sketch
// (#860). These tests pin the route's wiring: the `edit_jobs` gate, the
// job-visibility guard (mirroring the reports route's #446 fix — a caller can't
// add a Room to a Job their org can't see), basic payload validation, and
// forwarding the dimensions to the create step. The measurement math + insert is
// covered in src/lib/sketch/create-room.test.ts, so here `createSketchRoom` is
// mocked.

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
vi.mock("@/lib/sketch/create-room", () => ({
  createSketchRoom: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { createSketchRoom } from "@/lib/sketch/create-room";
import {
  fakeUserClient,
  memberTables,
} from "../../../../__test-utils__/request-context-fakes";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postBody(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A caller who is a member with edit_jobs and for whom the URL's Job (`job-1`)
// is visible in their Organization.
function authedClient() {
  return fakeUserClient({
    user: { id: "user-1" },
    tables: memberTables({
      userId: "user-1",
      role: "member",
      grants: ["edit_jobs"],
      extraTables: {
        jobs: [{ id: "job-1", organization_id: "org-1" }],
      },
    }),
  });
}

const validRoom = {
  floorId: "floor-1",
  name: "Living Room",
  width: 3,
  length: 4,
  ceilingHeightOverride: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(createSketchRoom).mockResolvedValue({ id: "room-1" } as never);
});

describe("POST /api/jobs/[id]/sketch/rooms", () => {
  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(postBody(validRoom), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(createSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 404 without creating a Room when the Job is not visible to the caller's org", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({
          userId: "user-1",
          role: "member",
          grants: ["edit_jobs"],
          // No `jobs` row: the job is not visible to this caller's org.
        }),
      }) as never,
    );

    const res = await POST(postBody(validRoom), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(createSketchRoom).not.toHaveBeenCalled();
  });

  it("returns 400 without creating a Room when the payload is missing a floor or dimensions", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({ name: "No floor", width: 3, length: 4 }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(400);
    expect(createSketchRoom).not.toHaveBeenCalled();
  });

  it("creates the Room (201) and forwards the floor + dimensions to the create step", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    const res = await POST(
      postBody({
        floorId: "floor-1",
        name: "Living Room",
        width: 3,
        length: 4,
        ceilingHeightOverride: 10,
      }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(201);
    expect(createSketchRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        floorId: "floor-1",
        name: "Living Room",
        width: 3,
        length: 4,
        ceilingHeightOverride: 10,
      }),
    );
  });
});
