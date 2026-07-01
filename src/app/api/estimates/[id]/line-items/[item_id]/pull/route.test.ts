import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-active-org", () => ({
  getActiveOrganizationId: vi.fn(),
}));

import { POST } from "./route";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import {
  fakeUserClient,
  memberTables,
} from "../../../../../__test-utils__/request-context-fakes";

const routeCtx = { params: Promise.resolve({ id: "est-1", item_id: "item-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveOrganizationId).mockResolvedValue("org-1");
});

function useUser(opts: Parameters<typeof fakeUserClient>[0]) {
  const client = fakeUserClient(opts);
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as never);
  return client;
}

function pullRequest(body: unknown) {
  return new Request("http://test/api/estimates/est-1/line-items/item-1/pull", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A Job whose Sketch has one Floor with one Room. The Room's six cached
// measurements are all distinct (PostgREST returns numerics as strings, so they
// are seeded as strings) so a wrong kind→column mapping surfaces as a wrong
// number. unit_price 10 makes the frozen total easy to read.
function seed(extra?: Record<string, unknown[]>) {
  return memberTables({
    userId: "user-1",
    role: "member",
    grants: ["edit_estimates"],
    extraTables: {
      estimates: [
        { id: "est-1", job_id: "job-1", deleted_at: null, updated_at: "2026-06-01T00:00:00Z" },
      ],
      estimate_line_items: [
        { id: "item-1", estimate_id: "est-1", section_id: "sec-1", quantity: 1, unit_price: 10, total: 10 },
      ],
      sketches: [{ id: "sk-1", job_id: "job-1" }],
      floors: [{ id: "fl-1", sketch_id: "sk-1" }],
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

describe("POST /api/estimates/[id]/line-items/[item_id]/pull (#861)", () => {
  it("freezes the chosen Room measurement into quantity + sketch_source", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(pullRequest({ roomId: "rm-1", kind: "wall_area_net" }), routeCtx);

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    // Net wall area 100 becomes the frozen quantity; total = 100 × 10.
    expect(upd?.payload).toMatchObject({
      quantity: 100,
      total: 1000,
      sketch_source: {
        scope: "room",
        sketch_id: "sk-1",
        floor_id: "fl-1",
        room_id: "rm-1",
        room_name: "Living Room",
        kind: "wall_area_net",
        value: 100,
      },
    });
    // The pull is stamped with a real timestamp by the route (the resolver is pure).
    const source = (upd?.payload as { sketch_source: { pulled_at: unknown } }).sketch_source;
    expect(typeof source.pulled_at).toBe("string");
  });

  it("freezes a Floor's aggregate measurement into quantity + sketch_source (scope: floor)", async () => {
    // Two Rooms on Ground Floor; the Floor's floor_area total is 12 + 20 = 32 —
    // the M2 roll-up, not any single Room's number.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        floors: [{ id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" }],
        rooms: [
          { id: "rm-1", floor_id: "fl-1", name: "Living Room", floor_area: "12", ceiling_area: "13", perimeter: "14", gross_wall_area: "112", net_wall_area: "100", volume: "96" },
          { id: "rm-2", floor_id: "fl-1", name: "Kitchen", floor_area: "20", ceiling_area: "20", perimeter: "18", gross_wall_area: "150", net_wall_area: "130", volume: "160" },
        ],
      }),
    });

    const res = await POST(
      pullRequest({ scope: "floor", floorId: "fl-1", kind: "floor_area" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    // The summed floor area 32 becomes the frozen quantity; total = 32 × 10.
    expect(upd?.payload).toMatchObject({
      quantity: 32,
      total: 320,
      sketch_source: {
        scope: "floor",
        sketch_id: "sk-1",
        floor_id: "fl-1",
        floor_name: "Ground Floor",
        kind: "floor_area",
        value: 32,
      },
    });
  });

  it("freezes the whole-Sketch aggregate measurement into quantity + sketch_source (scope: sketch)", async () => {
    // Two Floors, one Room each; the whole-Sketch volume total is 96 + 160 = 256
    // — the sum across every Floor, not any single Room or Floor.
    const client = useUser({
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

    const res = await POST(
      pullRequest({ scope: "sketch", kind: "volume" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    // Summed volume 256 becomes the frozen quantity; total = 256 × 10. The
    // breadcrumb carries only the Sketch identity — the total spans every Floor.
    expect(upd?.payload).toMatchObject({
      quantity: 256,
      total: 2560,
      sketch_source: {
        scope: "sketch",
        sketch_id: "sk-1",
        kind: "volume",
        value: 256,
      },
    });
  });

  it("refuses a Floor from another job's Sketch (404, no write)", async () => {
    // A Floor the org can see but that belongs to a DIFFERENT job's Sketch must
    // not be pullable — it resolves only through THIS estimate's job → Sketch.
    const client = useUser({
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
      }),
    });

    const res = await POST(
      pullRequest({ scope: "floor", floorId: "fl-2", kind: "floor_area" }),
      routeCtx,
    );

    expect(res.status).toBe(404);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("refuses a Room from another job's Sketch (404, no write)", async () => {
    // A Room the caller's org can see but that belongs to a DIFFERENT job's
    // Sketch must not be pullable into this estimate — the freeze would bill a
    // measurement from an unrelated job. The room resolves only through THIS
    // estimate's job → Sketch → Floors, so an off-job room id is "not found".
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        sketches: [
          { id: "sk-1", job_id: "job-1" },
          { id: "sk-2", job_id: "job-2" },
        ],
        floors: [
          { id: "fl-1", sketch_id: "sk-1" },
          { id: "fl-2", sketch_id: "sk-2" },
        ],
        rooms: [
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

    const res = await POST(pullRequest({ roomId: "rm-2", kind: "floor_area" }), routeCtx);

    expect(res.status).toBe(404);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  // ── object_count pulls (#867, S7) ─────────────────────────────────────────
  // The count half of M3: a line item can pull the COUNT of one object category
  // instead of a measurement. These pin that the pull honors `object_category`
  // (a different category freezes a different number), rides the same
  // room/floor/sketch scopes, and records the category in the breadcrumb.

  it("freezes a Room's object_count honoring the chosen object_category (cabinets)", async () => {
    // rm-1 holds 3 cabinets and 1 refrigerator. Counting cabinets must freeze 3.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        room_objects: [
          { id: "o1", room_id: "rm-1", category: "cabinets" },
          { id: "o2", room_id: "rm-1", category: "cabinets" },
          { id: "o3", room_id: "rm-1", category: "cabinets" },
          { id: "o4", room_id: "rm-1", category: "refrigerator" },
        ],
      }),
    });

    const res = await POST(
      pullRequest({ roomId: "rm-1", kind: "object_count", object_category: "cabinets" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    // 3 cabinets becomes the frozen quantity; total = 3 × 10.
    expect(upd?.payload).toMatchObject({
      quantity: 3,
      total: 30,
      sketch_source: {
        scope: "room",
        sketch_id: "sk-1",
        floor_id: "fl-1",
        room_id: "rm-1",
        room_name: "Living Room",
        kind: "object_count",
        object_category: "cabinets",
        value: 3,
      },
    });
  });

  it("freezes a different count for a different object_category on the same Room (refrigerator)", async () => {
    // Same Room, same objects — but counting refrigerators freezes 1, not 3.
    // Proves the pull is scoped by object_category, not just 'how many objects'.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        room_objects: [
          { id: "o1", room_id: "rm-1", category: "cabinets" },
          { id: "o2", room_id: "rm-1", category: "cabinets" },
          { id: "o3", room_id: "rm-1", category: "cabinets" },
          { id: "o4", room_id: "rm-1", category: "refrigerator" },
        ],
      }),
    });

    const res = await POST(
      pullRequest({ roomId: "rm-1", kind: "object_count", object_category: "refrigerator" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      quantity: 1,
      total: 10,
      sketch_source: { kind: "object_count", object_category: "refrigerator", value: 1 },
    });
  });

  it("freezes a Floor's object_count summed across its Rooms (scope: floor)", async () => {
    // Two Rooms on the Floor: rm-1 has 2 toilets, rm-2 has 2 toilets → 4.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        floors: [{ id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" }],
        rooms: [
          { id: "rm-1", floor_id: "fl-1", name: "Bath A", floor_area: "12", ceiling_area: "13", perimeter: "14", gross_wall_area: "112", net_wall_area: "100", volume: "96" },
          { id: "rm-2", floor_id: "fl-1", name: "Bath B", floor_area: "20", ceiling_area: "20", perimeter: "18", gross_wall_area: "150", net_wall_area: "130", volume: "160" },
        ],
        room_objects: [
          { id: "o1", room_id: "rm-1", category: "toilet" },
          { id: "o2", room_id: "rm-1", category: "toilet" },
          { id: "o3", room_id: "rm-2", category: "toilet" },
          { id: "o4", room_id: "rm-2", category: "toilet" },
        ],
      }),
    });

    const res = await POST(
      pullRequest({ scope: "floor", floorId: "fl-1", kind: "object_count", object_category: "toilet" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      quantity: 4,
      total: 40,
      sketch_source: {
        scope: "floor",
        floor_id: "fl-1",
        floor_name: "Ground Floor",
        kind: "object_count",
        object_category: "toilet",
        value: 4,
      },
    });
  });

  it("freezes the whole-Sketch object_count summed across every Floor (scope: sketch)", async () => {
    // Two Floors, one Room each: 7 cabinets + 5 cabinets = 12 across the Sketch.
    const client = useUser({
      user: { id: "user-1" },
      tables: seed({
        floors: [
          { id: "fl-1", sketch_id: "sk-1", name: "Ground Floor" },
          { id: "fl-2", sketch_id: "sk-1", name: "Second Floor" },
        ],
        rooms: [
          { id: "rm-1", floor_id: "fl-1", name: "Kitchen A", floor_area: "12", ceiling_area: "13", perimeter: "14", gross_wall_area: "112", net_wall_area: "100", volume: "96" },
          { id: "rm-2", floor_id: "fl-2", name: "Kitchen B", floor_area: "20", ceiling_area: "20", perimeter: "18", gross_wall_area: "150", net_wall_area: "130", volume: "160" },
        ],
        room_objects: [
          ...Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, room_id: "rm-1", category: "cabinets" })),
          ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, room_id: "rm-2", category: "cabinets" })),
        ],
      }),
    });

    const res = await POST(
      pullRequest({ scope: "sketch", kind: "object_count", object_category: "cabinets" }),
      routeCtx,
    );

    expect(res.status).toBe(200);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd?.payload).toMatchObject({
      quantity: 12,
      total: 120,
      sketch_source: {
        scope: "sketch",
        sketch_id: "sk-1",
        kind: "object_count",
        object_category: "cabinets",
        value: 12,
      },
    });
  });

  it("rejects an object_count pull with no object_category (400, no write)", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      pullRequest({ roomId: "rm-1", kind: "object_count" }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("rejects an object_count pull with an unknown object_category (400, no write)", async () => {
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      pullRequest({ roomId: "rm-1", kind: "object_count", object_category: "spaceship" }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });

  it("rejects an unknown measurement kind (400, no write)", async () => {
    // A kind that isn't one of the six Room measurements must be refused at the
    // door — never resolved to an `undefined` field that would freeze a NaN into
    // the estimate total. Validation happens before any Room lookup.
    const client = useUser({ user: { id: "user-1" }, tables: seed() });

    const res = await POST(
      pullRequest({ roomId: "rm-1", kind: "square_footage" }),
      routeCtx,
    );

    expect(res.status).toBe(400);
    const upd = client.__mutations.find(
      (m) => m.table === "estimate_line_items" && m.op === "update",
    );
    expect(upd).toBeUndefined();
  });
});
