// Issue #871 — Sketch S12: apply a RoomPlan scan to a Job's Sketch.
//
// applyRoomScan is the orchestrator behind the editor's "Scan room" button. A scan
// is an INPUT to the Job's one Sketch (ADR 0025), never a parallel artifact — so
// this bootstraps that Sketch if the Job has none, resolves its first Floor, maps
// the capture (M11), and writes the resulting Room and its known objects. The pure
// mapping is map-capture's own test and each write path is create-room/create-object's;
// here a chainable Supabase stub over the four touched tables lets us assert that a
// scan lands as a Room-with-objects on the resolved Floor, and that an empty capture
// still leaves an empty-but-valid Sketch behind (the acceptance criterion).

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { applyRoomScan } from "./apply-scan";
import type { CapturedObject, CapturedRoom, CapturedSurface } from "@/lib/mobile/roomplan-capture";

// --- Fixture builders (see map-capture.test.ts for the transform rationale) ------
// Real column-major transforms so mapCapturedRoom's decoding runs for real: column
// 0 is the surface's length axis in world space, column 3 its centre; the floor is
// world XZ. The orchestrator delegates all geometry to M11, so we only need enough
// to yield a valid footprint plus one opening and one object that thread through.
function surface({
  length,
  height,
  cx,
  cz,
  alongZ = false,
}: {
  length: number;
  height: number;
  cx: number;
  cz: number;
  alongZ?: boolean;
}): CapturedSurface {
  const col0 = alongZ ? [0, 0, 1] : [1, 0, 0];
  const col2 = alongZ ? [1, 0, 0] : [0, 0, 1];
  return {
    identifier: `s-${cx}-${cz}-${alongZ ? "z" : "x"}`,
    dimensions: [length, height, 0.1],
    transform: [
      col0[0], col0[1], col0[2], 0,
      0, 1, 0, 0,
      col2[0], col2[1], col2[2], 0,
      cx, height / 2, cz, 1,
    ],
    confidence: "high",
  };
}

function rectangleWalls(width: number, depth: number, height = 2.4): CapturedSurface[] {
  const hx = width / 2;
  const hz = depth / 2;
  return [
    surface({ length: width, height, cx: 0, cz: +hz }),
    surface({ length: width, height, cx: 0, cz: -hz }),
    surface({ length: depth, height, cx: +hx, cz: 0, alongZ: true }),
    surface({ length: depth, height, cx: -hx, cz: 0, alongZ: true }),
  ];
}

function object({ category, cx, cz }: { category: string; cx: number; cz: number }): CapturedObject {
  return { ...surface({ length: 0.6, height: 0.9, cx, cz }), category };
}

function emptyRoom(): CapturedRoom {
  return { walls: [], doors: [], windows: [], openings: [], objects: [] };
}

// A Supabase stub over the four tables applyRoomScan touches. Each `from(table)`
// call gets its own builder so `single()`/`maybeSingle()` echo the payload captured
// on THAT call — mirroring how each write path reads then writes.
//   - sketches: the load read resolves to `existingSketch`; an insert's `.single()`
//     echoes it back as "sketch-new".
//   - floors: the awaited bootstrap insert (no `.select()`) resolves via `then`; the
//     first-Floor resolution and create-room's Floor read both `.maybeSingle()` to
//     `floor`.
//   - rooms: create-room's insert `.single()` echoes as "room-1"; create-object's
//     existence read `.maybeSingle()` resolves to that same room.
//   - room_objects: each insert `.single()` echoes as "obj-N".
// `writes` exposes the single-row payloads and the list of object payloads.
function fakeSupabase(opts: {
  existingSketch: { id: string } | null;
  floor: { id: string; default_ceiling_height: string };
}) {
  const writes: {
    sketches?: Record<string, unknown>;
    floors?: Record<string, unknown>;
    rooms?: Record<string, unknown>;
    objects: Record<string, unknown>[];
  } = { objects: [] };
  let objectSeq = 0;

  function from(table: string) {
    let captured: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (payload: Record<string, unknown>) => {
        captured = payload;
        if (table === "room_objects") writes.objects.push(payload);
        else (writes as Record<string, unknown>)[table] = payload;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "sketches") return { data: opts.existingSketch, error: null };
        if (table === "floors") return { data: opts.floor, error: null };
        if (table === "rooms") return { data: { id: "room-1" }, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        const id =
          table === "sketches"
            ? "sketch-new"
            : table === "rooms"
              ? "room-1"
              : `obj-${++objectSeq}`;
        return { data: { id, ...captured }, error: null };
      },
      then: (resolve: (v: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, writes };
}

describe("applyRoomScan", () => {
  it("fills the Job's Sketch with a Room and its objects on the first Floor", async () => {
    // A Job with no Sketch yet. The scan is a 4×3 m room with one window and two
    // detected objects — a refrigerator (kept) and a fireplace (dropped, we don't
    // bill it). It must bootstrap the Sketch, place the mapped Room on the resolved
    // first Floor, and write one room_objects row per KEPT object, threaded to it.
    const { client, writes } = fakeSupabase({
      existingSketch: null,
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });
    const room: CapturedRoom = {
      ...emptyRoom(),
      walls: rectangleWalls(4, 3),
      windows: [surface({ length: 1.2, height: 1.0, cx: 0.5, cz: 1.5 })],
      objects: [
        object({ category: "refrigerator", cx: -1.5, cz: 1.0 }),
        object({ category: "fireplace", cx: 0, cz: 0 }),
      ],
    };

    const result = await applyRoomScan(client, {
      organizationId: "org-1",
      jobId: "job-1",
      room,
    });

    // The Sketch was bootstrapped (1:1 with the Job) and its id flows out.
    expect(writes.sketches).toMatchObject({ organization_id: "org-1", job_id: "job-1" });
    expect(result.sketchId).toBe("sketch-new");

    // The mapped Room landed on the resolved first Floor, org-scoped.
    expect(result.room?.id).toBe("room-1");
    expect(writes.rooms).toMatchObject({
      organization_id: "org-1",
      floor_id: "floor-1",
      name: "Scanned Room",
    });
    expect((writes.rooms?.footprint as unknown[]).length).toBe(4);
    expect((writes.rooms?.openings as { type: string }[])).toHaveLength(1);
    expect((writes.rooms?.openings as { type: string }[])[0].type).toBe("window");

    // One object row per kept category, each bound to the new Room; the fireplace
    // dropped out in mapping so it never reaches the DB.
    expect(result.objects).toHaveLength(1);
    expect(writes.objects).toHaveLength(1);
    expect(writes.objects[0]).toMatchObject({
      organization_id: "org-1",
      room_id: "room-1",
      category: "refrigerator",
    });
    expect(result.objects[0].category).toBe("refrigerator");
  });

  it("loads the Job's existing Sketch instead of creating a second (1:1)", async () => {
    // A re-scan, or a scan of a Job whose Sketch was already opened. The scan fills
    // the SAME Sketch (ADR 0025 / the 1:1 anchor) — no bootstrap insert — and the
    // new Room is placed on that Sketch's resolved Floor.
    const { client, writes } = fakeSupabase({
      existingSketch: { id: "sketch-1" },
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    const result = await applyRoomScan(client, {
      organizationId: "org-1",
      jobId: "job-1",
      room: { ...emptyRoom(), walls: rectangleWalls(4, 3) },
    });

    expect(result.sketchId).toBe("sketch-1");
    expect(writes.sketches).toBeUndefined(); // no duplicate Sketch
    expect(result.room?.id).toBe("room-1");
    expect(writes.rooms).toMatchObject({ floor_id: "floor-1" });
  });

  it("ensures an empty-but-valid Sketch for an empty capture, writing no Room", async () => {
    // AC: an empty capture yields an empty-but-valid Sketch. The Sketch (and its
    // bootstrap Floor) are still established, but there is no Room to place and thus
    // no objects — the editor opens on a blank Sketch to draw from scratch.
    const { client, writes } = fakeSupabase({
      existingSketch: null,
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    const result = await applyRoomScan(client, {
      organizationId: "org-1",
      jobId: "job-1",
      room: emptyRoom(),
    });

    expect(result.sketchId).toBe("sketch-new");
    expect(writes.sketches).toBeDefined(); // the Sketch was still ensured
    expect(result.room).toBeNull();
    expect(result.objects).toEqual([]);
    expect(writes.rooms).toBeUndefined(); // nothing drawn
    expect(writes.objects).toEqual([]);
  });
});
