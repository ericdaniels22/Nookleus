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
