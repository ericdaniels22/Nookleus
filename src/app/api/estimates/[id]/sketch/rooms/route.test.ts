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

// Build a full object inventory (every known category present) from a sparse set
// of non-zero counts — the shape the feed returns for a Room / Floor / Sketch.
function inv(overrides: Record<string, number> = {}) {
  return {
    cabinets: 0,
    refrigerator: 0,
    stove: 0,
    oven: 0,
    dishwasher: 0,
    washer_dryer: 0,
    sink: 0,
    toilet: 0,
    bathtub: 0,
    furniture: 0,
    ...overrides,
  };
}

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
      // Keyed by the same six pull kinds the POST endpoint accepts, coerced to
      // numbers so the picker can preview `measurements[kind]` directly.
      measurements: {
        floor_area: 12,
        ceiling_area: 13,
        wall_area_net: 100,
        wall_area_gross: 112,
        perimeter: 14,
        volume: 96,
      },
      // This Room has no placed objects, so its inventory is every known
      // category at 0 (S7 — a Room always reports a full inventory).
      objects: inv(),
    });
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

    // Each Floor's aggregate, keyed by the same pull kinds as the Rooms; neither
    // Floor has placed objects here, so each reports an all-zero inventory.
    expect(body.floors).toEqual([
      {
        id: "fl-1",
        name: "Ground Floor",
        measurements: { floor_area: 12, ceiling_area: 13, wall_area_net: 100, wall_area_gross: 112, perimeter: 14, volume: 96 },
        objects: inv(),
      },
      {
        id: "fl-2",
        name: "Second Floor",
        measurements: { floor_area: 20, ceiling_area: 20, wall_area_net: 130, wall_area_gross: 150, perimeter: 18, volume: 160 },
        objects: inv(),
      },
    ]);

    // The whole-Sketch total sums both Floors.
    expect(body.sketch).toEqual({
      sketch_id: "sk-1",
      measurements: { floor_area: 32, ceiling_area: 33, wall_area_net: 230, wall_area_gross: 262, perimeter: 32, volume: 256 },
      objects: inv(),
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

  it("reports each Room's object inventory keyed by category (#867)", async () => {
    // A Room carries a count-only inventory of known objects (S7). The picker
    // previews `objects[category]` before an object_count pull freezes it, so
    // the feed projects each Room's inventory the same way the pull does. Every
    // known category is present (0 when the Room has none) so a reader never
    // branches on a missing key.
    useUser({
      user: { id: "user-1" },
      tables: seed({
        room_objects: [
          { id: "o1", room_id: "rm-1", category: "cabinets" },
          { id: "o2", room_id: "rm-1", category: "cabinets" },
          { id: "o3", room_id: "rm-1", category: "sink" },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rooms: Array<{ id: string; objects: Record<string, number> }>;
    };
    expect(body.rooms[0].objects).toEqual(inv({ cabinets: 2, sink: 1 }));
  });

  it("rolls each Floor's and the whole-Sketch's object inventory up from its Rooms (#867)", async () => {
    // Object counts aggregate up the same tiers as measurements (M2 monoid): a
    // Floor's inventory sums its Rooms', the Sketch's sums every Floor's. So the
    // picker can offer an object_count at Floor or whole-Sketch scope and preview
    // the count before freezing. Ground: 2 cabinets + 1 sink; Second: 3 cabinets
    // + 1 toilet — the Sketch total is 5 cabinets, 1 sink, 1 toilet.
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
        room_objects: [
          { id: "o1", room_id: "rm-1", category: "cabinets" },
          { id: "o2", room_id: "rm-1", category: "cabinets" },
          { id: "o3", room_id: "rm-1", category: "sink" },
          { id: "o4", room_id: "rm-2", category: "cabinets" },
          { id: "o5", room_id: "rm-2", category: "cabinets" },
          { id: "o6", room_id: "rm-2", category: "cabinets" },
          { id: "o7", room_id: "rm-2", category: "toilet" },
        ],
      }),
    });

    const res = await GET(getRequest(), routeCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      floors: Array<{ id: string; objects: Record<string, number> }>;
      sketch: { objects: Record<string, number> } | null;
    };

    expect(body.floors.map((f) => f.objects)).toEqual([
      inv({ cabinets: 2, sink: 1 }),
      inv({ cabinets: 3, toilet: 1 }),
    ]);
    expect(body.sketch?.objects).toEqual(inv({ cabinets: 5, sink: 1, toilet: 1 }));
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
