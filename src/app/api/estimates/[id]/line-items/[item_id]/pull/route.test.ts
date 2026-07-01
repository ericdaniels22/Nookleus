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
