import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import type { SketchOpening } from "@/lib/types";
import type { RoomMeasurements } from "@/lib/sketch/measure-room";
import {
  ALL_PULL_KINDS,
  pullValue,
  type PullKind,
} from "@/lib/sketch/pull-resolver";
import {
  aggregateFloor,
  aggregateSketch,
  type RoomContribution,
  type SketchAggregate,
  type SketchCounts,
} from "@/lib/sketch/aggregate";
import {
  objectInventory,
  sumInventories,
  type HasCategory,
  type ObjectCategory,
  type ObjectInventory,
} from "@/lib/sketch/object-inventory";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface RoomRow {
  id: string;
  name: string;
  floor_id: string;
  floor_area: number | string;
  ceiling_area: number | string;
  perimeter: number | string;
  gross_wall_area: number | string;
  net_wall_area: number | string;
  volume: number | string;
  openings: SketchOpening[] | null;
}

// PostgREST returns numerics as strings — coerce back to the numbers M1/M2 speak.
function toMeasurements(room: RoomRow): RoomMeasurements {
  return {
    floorArea: Number(room.floor_area),
    ceilingArea: Number(room.ceiling_area),
    perimeter: Number(room.perimeter),
    grossWallArea: Number(room.gross_wall_area),
    netWallArea: Number(room.net_wall_area),
    volume: Number(room.volume),
  };
}

// A Room's door/window tally from its openings, by kind (#866) — the same tally
// the pull route freezes, so a preview equals what a count pull would land.
function openingCounts(openings: SketchOpening[] | null): {
  doors: number;
  windows: number;
} {
  const list = openings ?? [];
  return {
    doors: list.filter((o) => o.type === "door").length,
    windows: list.filter((o) => o.type === "window").length,
  };
}

// Project a source's measurements + counts onto every pull kind via the same M3
// resolver the freeze uses, so a preview equals what the pull would land in
// `quantity` — the six measurements plus door_count / window_count (#866).
function byKind(
  m: RoomMeasurements,
  counts: SketchCounts,
): Record<PullKind, number> {
  const out = {} as Record<PullKind, number>;
  for (const kind of ALL_PULL_KINDS) {
    out[kind] = pullValue(m, counts, kind);
  }
  return out;
}

/**
 * GET /api/estimates/[id]/sketch/rooms — the picker feed for "Pull from Sketch"
 * (#861). Lists the Rooms of THIS estimate's job's Sketch, each with its floor
 * name and its six measurements keyed by the same kinds the pull endpoint
 * accepts, so the picker can preview `measurements[kind]` before freezing it
 * into a line item. Read-only and org-scoped by the RLS client; a Room from
 * another job is unreachable because we only walk this estimate's job → Sketch →
 * Floors → Rooms. No Sketch yet is a valid empty state, not an error.
 */
export const GET = withRequestContext(
  { permission: "view_estimates" },
  async (_request, { supabase }, ctx: RouteCtx) => {
    const { id: estimateId } = await ctx.params;

    const { data: estimate } = await supabase
      .from("estimates")
      .select("job_id")
      .eq("id", estimateId)
      .maybeSingle<{ job_id: string | null }>();
    if (!estimate) {
      return NextResponse.json({ error: "estimate not found" }, { status: 404 });
    }
    if (!estimate.job_id) {
      return NextResponse.json({ rooms: [], floors: [], sketch: null });
    }

    const { data: sketch } = await supabase
      .from("sketches")
      .select("id")
      .eq("job_id", estimate.job_id)
      .maybeSingle<{ id: string }>();
    if (!sketch) {
      return NextResponse.json({ rooms: [], floors: [], sketch: null });
    }

    const { data: floors, error: floorsError } = await supabase
      .from("floors")
      .select("id, name")
      .eq("sketch_id", sketch.id);
    if (floorsError) {
      return apiDbError(floorsError.message, "GET /api/estimates/[id]/sketch/rooms floors");
    }
    const floorNameById = new Map(
      (floors ?? []).map((f: { id: string; name: string }) => [f.id, f.name]),
    );
    const floorIds = [...floorNameById.keys()];
    if (floorIds.length === 0) {
      return NextResponse.json({ rooms: [], floors: [], sketch: null });
    }

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select(
        "id, name, floor_id, floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume, openings",
      )
      .in("floor_id", floorIds);
    if (roomsError) {
      return apiDbError(roomsError.message, "GET /api/estimates/[id]/sketch/rooms rooms");
    }

    // Each Room's count-only object inventory (S7): read every placed object for
    // these Rooms in one pass and group by Room, so the same M1 projection the
    // object_count pull freezes previews here — a preview equals what the pull
    // would land in `quantity`.
    const roomIds = (rooms ?? []).map((room: RoomRow) => room.id);
    const objectsByRoom = new Map<string, HasCategory[]>();
    if (roomIds.length > 0) {
      const { data: objectRows, error: objectsError } = await supabase
        .from("room_objects")
        .select("room_id, category")
        .in("room_id", roomIds)
        .returns<Array<{ room_id: string; category: ObjectCategory }>>();
      if (objectsError) {
        return apiDbError(
          objectsError.message,
          "GET /api/estimates/[id]/sketch/rooms objects",
        );
      }
      for (const row of objectRows ?? []) {
        const list = objectsByRoom.get(row.room_id) ?? [];
        list.push({ category: row.category });
        objectsByRoom.set(row.room_id, list);
      }
    }

    // Rooms for the picker, and — as we go — each Room's contribution grouped by
    // Floor so the same coerced measurements feed the Floor / Sketch roll-ups (M2)
    // without a second pass or re-coercion.
    const contributionsByFloor = new Map<string, RoomContribution[]>();
    const objectsByFloor = new Map<string, ObjectInventory[]>();
    const roomsPayload = (rooms ?? []).map((room: RoomRow) => {
      const measurements = toMeasurements(room);
      const { doors, windows } = openingCounts(room.openings);
      const contributions = contributionsByFloor.get(room.floor_id) ?? [];
      contributions.push({ measurements, doors, windows });
      contributionsByFloor.set(room.floor_id, contributions);
      const objects = objectInventory(objectsByRoom.get(room.id) ?? []);
      const floorObjects = objectsByFloor.get(room.floor_id) ?? [];
      floorObjects.push(objects);
      objectsByFloor.set(room.floor_id, floorObjects);
      return {
        id: room.id,
        name: room.name,
        floor_id: room.floor_id,
        floor_name: floorNameById.get(room.floor_id) ?? "",
        // A single Room's own door/window tally (rooms: 1 for completeness).
        measurements: byKind(measurements, { rooms: 1, doors, windows }),
        objects,
      };
    });

    // Each Floor's total (M2), and the whole-Sketch total summed across Floors —
    // the options the picker offers for Floor-scoped and Sketch-scoped pulls.
    const floorAggregates: SketchAggregate[] = floorIds.map((id) =>
      aggregateFloor(contributionsByFloor.get(id) ?? []),
    );
    // Each Floor's object inventory sums its Rooms', and the Sketch's sums every
    // Floor's — the same M1 monoid at both tiers (an empty part-list sums to all
    // zeros), matching how the object_count pull rolls counts up.
    const floorObjectInventories = floorIds.map((id) =>
      sumInventories(objectsByFloor.get(id) ?? []),
    );
    const floorsPayload = floorIds.map((id, i) => ({
      id,
      name: floorNameById.get(id) ?? "",
      measurements: byKind(floorAggregates[i].measurements, floorAggregates[i].counts),
      objects: floorObjectInventories[i],
    }));
    const sketchTotal = aggregateSketch(floorAggregates);
    const sketchPayload = {
      sketch_id: sketch.id,
      measurements: byKind(sketchTotal.measurements, sketchTotal.counts),
      objects: sumInventories(floorObjectInventories),
    };

    return NextResponse.json({
      rooms: roomsPayload,
      floors: floorsPayload,
      sketch: sketchPayload,
    });
  },
);
