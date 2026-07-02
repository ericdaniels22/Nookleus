// POST /api/jobs/[id]/sketch/scan — apply a RoomPlan scan to a Job's Sketch (#871).
// These tests pin the route's wiring: the `edit_jobs` gate, the job-visibility
// guard (a caller can't scan into a Job their org can't see — mirrors the rooms
// route), rejecting a body that isn't a CapturedRoom, and forwarding the capture to
// applyRoomScan. The mapping + persistence is covered in src/lib/sketch — here
// applyRoomScan is mocked, so this only asserts the HTTP boundary.

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
vi.mock("@/lib/sketch/apply-scan", () => ({
  applyRoomScan: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { applyRoomScan } from "@/lib/sketch/apply-scan";
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

// A caller who is a member with edit_jobs and for whom the URL's Job (`job-1`) is
// visible in their Organization.
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

// The minimal valid CapturedRoom: the five surface arrays present (empty is valid —
// an empty capture still ensures the Sketch). Contents are the plugin's own
// serialized RoomPlan output; the route only checks the shape at its boundary.
const EMPTY_CAPTURE = {
  walls: [],
  doors: [],
  windows: [],
  openings: [],
  objects: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
  vi.mocked(applyRoomScan).mockResolvedValue({
    sketchId: "sketch-1",
    room: null,
    objects: [],
  } as never);
});

describe("POST /api/jobs/[id]/sketch/scan", () => {
  it("returns 403 for a member without the edit_jobs grant", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      fakeUserClient({
        user: { id: "user-1" },
        tables: memberTables({ userId: "user-1", role: "member", grants: [] }),
      }) as never,
    );

    const res = await POST(postBody({ room: EMPTY_CAPTURE }), paramsFor("job-1"));

    expect(res.status).toBe(403);
    expect(applyRoomScan).not.toHaveBeenCalled();
  });

  it("returns 404 without scanning when the Job is not visible to the caller's org", async () => {
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

    const res = await POST(postBody({ room: EMPTY_CAPTURE }), paramsFor("job-1"));

    expect(res.status).toBe(404);
    expect(applyRoomScan).not.toHaveBeenCalled();
  });

  it("returns 400 without scanning when the body is not a CapturedRoom", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );

    // `walls` is not an array — the payload doesn't satisfy the CapturedRoom shape.
    const res = await POST(
      postBody({ room: { ...EMPTY_CAPTURE, walls: "nope" } }),
      paramsFor("job-1"),
    );

    expect(res.status).toBe(400);
    expect(applyRoomScan).not.toHaveBeenCalled();
  });

  it("applies the scan (201) and forwards the capture to applyRoomScan", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue(
      authedClient() as never,
    );
    vi.mocked(applyRoomScan).mockResolvedValue({
      sketchId: "sketch-1",
      room: { id: "room-1" },
      objects: [{ id: "obj-1" }],
    } as never);

    const capture = {
      ...EMPTY_CAPTURE,
      walls: [
        {
          identifier: "w1",
          dimensions: [4, 2.4, 0.1],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.2, 1.5, 1],
          confidence: "high",
        },
      ],
    };

    const res = await POST(postBody({ room: capture }), paramsFor("job-1"));

    expect(res.status).toBe(201);
    expect(applyRoomScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: "org-1",
        jobId: "job-1",
        room: capture,
      }),
    );
    const json = await res.json();
    expect(json).toMatchObject({
      sketchId: "sketch-1",
      room: { id: "room-1" },
      objects: [{ id: "obj-1" }],
    });
  });
});
