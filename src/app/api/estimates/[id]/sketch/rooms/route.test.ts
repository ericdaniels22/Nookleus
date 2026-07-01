import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
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
} from "../../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function getRequest() {
  return new Request("http://test/api/estimates/est-1/sketch/rooms");
}

// The picker feed: an estimate whose job has a Sketch with one Floor and one
// Room. Measurements are seeded as strings (PostgREST returns numerics as
// strings) and are all distinct so a wrong column→kind mapping surfaces.
function seed(extra?: Record<string, unknown[]>) {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["view_estimates"],
    extraTables: {
      estimates: [{ id: "est-1", job_id: "job-1", deleted_at: null }],
      sketches: [{ id: "sk-1", job_id: "job-1" }],
      floors: [{ id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" }],
      rooms: [
        {
          id: "rm-1",
          floor_id: "fl-1",
          name: "Living Room",
          floor_area: "12",
          ceiling_area: "13",
          perimeter: "14",
          gross_wall_area: "112",
          net_wall_area: "100",
          volume: "96",
        },
      ],
      ...extra,
    },
  });
}

describe("GET /api/estimates/[id]/sketch/rooms (#861)", () => {
  it("lists the estimate's Sketch rooms with numeric measurements keyed by pull kind", async () => {
    useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rooms: Array<{
        id: string;
        name: string;
        floor_id: string;
        floor_name: string;
        measurements: Record<string, number>;
      }>;
    };
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]).toEqual({
      id: "rm-1",
      name: "Living Room",
      floor_id: "fl-1",
      floor_name: "Ground Floor",
      // Keyed by the same eight pull kinds the POST endpoint accepts, coerced to
      // numbers so the picker can preview `measurements[kind]` directly. This
      // Room has no openings, so both count kinds are 0 (#866).
      measurements: {
        floor_area: 12,
        ceiling_area: 13,
        wall_area_net: 100,
        wall_area_gross: 112,
        perimeter: 14,
        volume: 96,
        door_count: 0,
        window_count: 0,
      },
    });
  });

  it("keys each Room's door_count and window_count from its openings (#866)", async () => {
    // The picker offers the two count kinds alongside the six measurements, so
    // the feed must tally each Room's openings by type and expose them at
    // measurements[kind] like any other kind. Two doors + one window →
    // door_count 2, window_count 1.
    useUser({
      user: { id: "user-1" },
      tables: seed({
        rooms: [
          {
            id: "rm-1",
            floor_id: "fl-1",
            name: "Living Room",
            floor_area: "12",
            ceiling_area: "13",
            perimeter: "14",
            gross_wall_area: "112",
            net_wall_area: "100",
            volume: "96",
            openings: [
              { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
              { type: "door", width: 3, height: 7, wall_index: 1, offset: 1 },
              { type: "window", width: 3, height: 4, wall_index: 2, offset: 1 },
            ],
          },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rooms: Array<{ measurements: Record<string, number> }>;
    };
    expect(body.rooms[0].measurements.door_count).toBe(2);
    expect(body.rooms[0].measurements.window_count).toBe(1);
  });

  it("rolls each Floor's and the whole-Sketch's door/window counts up from openings (#866)", async () => {
    // Two Floors, one Room each. Ground's Room has 1 door + 2 windows; Second's
    // has 2 doors + 1 window. Each Floor total is its Room's tally; the Sketch
    // total sums both Floors → 3 doors / 3 windows.
    useUser({
      user: { id: "user-1" },
      tables: seed({
        floors: [
          { id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" },
          { id: "fl-2", sketch_id: "sk-1", name: "Second Floor" },
        ],
        rooms: [
          {
            id: "rm-1", floor_id: "fl-1", name: "Living Room", floor_area: "12", ceiling_area: "13", perimeter: "14", gross_wall_area: "112", net_wall_area: "100", volume: "96",
            openings: [
              { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
              { type: "window", width: 3, height: 4, wall_index: 1, offset: 1 },
              { type: "window", width: 3, height: 4, wall_index: 2, offset: 1 },
            ],
          },
          {
            id: "rm-2", floor_id: "fl-2", name: "Bedroom", floor_area: "20", ceiling_area: "20", perimeter: "18", gross_wall_area: "150", net_wall_area: "130", volume: "160",
            openings: [
              { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
              { type: "door", width: 3, height: 7, wall_index: 1, offset: 1 },
              { type: "window", width: 3, height: 4, wall_index: 2, offset: 1 },
            ],
          },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      floors: Array<{ id: string; measurements: Record<string, number> }>;
      sketch: { measurements: Record<string, number> } | null;
    };

    const ground = body.floors.find((f) => f.id === "fl-1")!;
    const second = body.floors.find((f) => f.id === "fl-2")!;
    expect(ground.measurements.door_count).toBe(1);
    expect(ground.measurements.window_count).toBe(2);
    expect(second.measurements.door_count).toBe(2);
    expect(second.measurements.window_count).toBe(1);
    expect(body.sketch!.measurements.door_count).toBe(3);
    expect(body.sketch!.measurements.window_count).toBe(3);
  });

  it("exposes each Floor's totals and the whole-Sketch totals keyed by pull kind", async () => {
    // Two Floors, one Room each, so the picker can offer Floor scope and
    // whole-Sketch scope alongside the Rooms (ADR 0026). Ground: fa 12 / vol 96;
    // Second: fa 20 / vol 160 — the Sketch total sums both Floors.
    useUser({
      user: { id: "user-1" },
      tables: seed({
        floors: [
          { id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" },
          { id: "fl-2", sketch_id: "sk-1", name: "Second Floor" },
        ],
        rooms: [
          { id: "rm-1", floor_id: "fl-1", name: "Living Room", floor_area: "12", ceiling_area: "13", perimeter: "14", gross_wall_area: "112", net_wall_area: "100", volume: "96" },
          { id: "rm-2", floor_id: "fl-2", name: "Bedroom", floor_area: "20", ceiling_area: "20", perimeter: "18", gross_wall_area: "150", net_wall_area: "130", volume: "160" },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      floors: Array<{ id: string; name: string; measurements: Record<string, number> }>;
      sketch: { sketch_id: string; measurements: Record<string, number> } | null;
    };

    // Each Floor's aggregate, keyed by the same pull kinds as the Rooms. Neither
    // Floor's Rooms carry openings, so both count kinds roll up to 0 (#866).
    expect(body.floors).toEqual([
      {
        id: "fl-1",
        name: "Ground Floor",
        measurements: { floor_area: 12, ceiling_area: 13, wall_area_net: 100, wall_area_gross: 112, perimeter: 14, volume: 96, door_count: 0, window_count: 0 },
      },
      {
        id: "fl-2",
        name: "Second Floor",
        measurements: { floor_area: 20, ceiling_area: 20, wall_area_net: 130, wall_area_gross: 150, perimeter: 18, volume: 160, door_count: 0, window_count: 0 },
      },
    ]);

    // The whole-Sketch total sums both Floors.
    expect(body.sketch).toEqual({
      sketch_id: "sk-1",
      measurements: { floor_area: 32, ceiling_area: 33, wall_area_net: 230, wall_area_gross: 262, perimeter: 32, volume: 256, door_count: 0, window_count: 0 },
    });
  });

  it("omits Rooms from another job's Sketch", async () => {
    // The picker must only offer Rooms the caller could legitimately freeze into
    // THIS estimate — the same job → Sketch → Floors walk the POST uses. A Room
    // on an unrelated job's Sketch (even one the org can see) must not appear.
    useUser({
      user: { id: "user-1" },
      tables: seed({
        sketches: [
          { id: "sk-1", job_id: "job-1" },
          { id: "sk-2", job_id: "job-2" },
        ],
        floors: [
          { id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" },
          { id: "fl-2", sketch_id: "sk-2", name: "Other Ground" },
        ],
        rooms: [
          {
            id: "rm-1",
            floor_id: "fl-1",
            name: "Living Room",
            floor_area: "12",
            ceiling_area: "13",
            perimeter: "14",
            gross_wall_area: "112",
            net_wall_area: "100",
            volume: "96",
          },
          {
            id: "rm-2",
            floor_id: "fl-2",
            name: "Other Job Room",
            floor_area: "50",
            ceiling_area: "50",
            perimeter: "30",
            gross_wall_area: "240",
            net_wall_area: "220",
            volume: "400",
          },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: Array<{ id: string }> };
    expect(body.rooms.map((r) => r.id)).toEqual(["rm-1"]);
  });

  it("returns an empty list when the job has no Sketch yet", async () => {
    // Opening the picker before a Sketch exists is a normal state, not an error:
    // the affordance simply shows nothing to pull.
    useUser({
      user: { id: "user-1" },
      tables: seed({ sketches: [], floors: [], rooms: [] }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: unknown[] };
    expect(body.rooms).toEqual([]);
  });
});
