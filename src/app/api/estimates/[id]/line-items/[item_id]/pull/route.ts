import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { checkSnapshot, recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { round2 } from "@/lib/format";
import type { EstimateLineItem, SketchOpening } from "@/lib/types";
import type { RoomMeasurements } from "@/lib/sketch/measure-room";
import {
  ALL_PULL_KINDS,
  resolveRoomPull,
  resolveFloorPull,
  resolveSketchPull,
  resolveRoomObjectPull,
  resolveFloorObjectPull,
  resolveSketchObjectPull,
  type ScalarPullKind,
  type SketchSource,
} from "@/lib/sketch/pull-resolver";
import { aggregateFloor, type RoomContribution } from "@/lib/sketch/aggregate";
import {
  OBJECT_CATEGORIES,
  objectInventory,
  type ObjectCategory,
  type ObjectInventory,
} from "@/lib/sketch/object-inventory";

interface RouteCtx {
  params: Promise<{ id: string; item_id: string }>;
}

/** What a pull is taken from: one Room, one Floor's total, or the whole Sketch. */
type PullScope = "room" | "floor" | "sketch";

interface PullBody {
  scope?: unknown;
  roomId?: unknown;
  floorId?: unknown;
  kind?: unknown;
  /** Present only for an object_count pull (#867): which category to count. */
  object_category?: unknown;
  updated_at_snapshot?: string;
}

function isKind(value: unknown): value is ScalarPullKind {
  return (
    typeof value === "string" &&
    (ALL_PULL_KINDS as readonly string[]).includes(value)
  );
}

/** One of the known object categories — the vocabulary an object_count is scoped by. */
function isObjectCategory(value: unknown): value is ObjectCategory {
  return (
    typeof value === "string" &&
    (OBJECT_CATEGORIES as readonly string[]).includes(value)
  );
}

// The columns a pull needs off a Room row: the six cached measurements plus the
// openings the count kinds (door_count/window_count) are tallied from (#866).
const MEASUREMENT_COLUMNS =
  "floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume, openings";

interface MeasurementRow {
  floor_area: number | string;
  ceiling_area: number | string;
  perimeter: number | string;
  gross_wall_area: number | string;
  net_wall_area: number | string;
  volume: number | string;
  openings: SketchOpening[] | null;
}

/** A Room's door/window tally from its openings, by kind (#866). */
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

// PostgREST returns numerics as strings — coerce back to the numbers M1/M2/M3
// reason about. These are the cached measurements written by createSketchRoom
// (M1's single writer); no recompute happens at pull time.
function toMeasurements(row: MeasurementRow): RoomMeasurements {
  return {
    floorArea: Number(row.floor_area),
    ceilingArea: Number(row.ceiling_area),
    perimeter: Number(row.perimeter),
    grossWallArea: Number(row.gross_wall_area),
    netWallArea: Number(row.net_wall_area),
    volume: Number(row.volume),
  };
}

// A Room's M2 contribution: its coerced measurements plus its door/window counts
// (#866), so a Floor / Sketch roll-up carries real counts, not zeros.
function toContribution(row: MeasurementRow): RoomContribution {
  const { doors, windows } = openingCounts(row.openings);
  return { measurements: toMeasurements(row), doors, windows };
}

/**
 * POST /api/estimates/[id]/line-items/[item_id]/pull — freeze a Sketch Room
 * measurement into this line item's `quantity` (#861, S2 "money slice").
 *
 * Server-authoritative: the client names a Room and a measurement kind; the
 * server reads the Room's cached measurements, resolves the chosen number via
 * the pure M3 resolver, and writes it into `quantity` alongside a frozen
 * `sketch_source` snapshot (ADR 0004/0025). The value is frozen at pull time —
 * re-scanning the Sketch afterward never changes the line item. The Room must
 * belong to THIS estimate's job's Sketch (verified below), so a Room from
 * another job in the same org can't be pulled.
 */
export const POST = withRequestContext(
  { permission: "edit_estimates" },
  async (request, { supabase }, ctx: RouteCtx) => {
    const { id: estimateId, item_id: itemId } = await ctx.params;

    // The estimate anchors both the trash guard and the job → Sketch resolution.
    const { data: estimate } = await supabase
      .from("estimates")
      .select("job_id, deleted_at")
      .eq("id", estimateId)
      .maybeSingle<{ job_id: string | null; deleted_at: string | null }>();
    if (!estimate) {
      return NextResponse.json({ error: "estimate not found" }, { status: 404 });
    }
    const trashed = assertNotTrashed(estimate);
    if (trashed) return trashed;

    let body: PullBody;
    try {
      body = (await request.json()) as PullBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    // A pull is scoped to one Room (default), one Floor's total, or the whole
    // Sketch (ADR 0026). The kind is required for every scope.
    const scope: PullScope =
      body.scope === undefined ? "room" : (body.scope as PullScope);
    if (scope !== "room" && scope !== "floor" && scope !== "sketch") {
      return NextResponse.json(
        { error: "scope must be room, floor, or sketch" },
        { status: 400 },
      );
    }
    // The kind is one of the scalar pull kinds — six measurements plus the
    // door/window counts (#866) — or `object_count`, a count of one object
    // category (#867). An object_count pull additionally names a known
    // `object_category` it is scoped by; every other kind names none.
    const isObjectCount = body.kind === "object_count";
    let kind: ScalarPullKind | null = null;
    if (!isObjectCount) {
      if (!isKind(body.kind)) {
        return NextResponse.json(
          {
            error: `kind must be one of ${ALL_PULL_KINDS.join(", ")}, or object_count`,
          },
          { status: 400 },
        );
      }
      kind = body.kind;
    }
    let objectCategory: ObjectCategory | null = null;
    if (isObjectCount) {
      if (!isObjectCategory(body.object_category)) {
        return NextResponse.json(
          {
            error: `object_category must be one of ${OBJECT_CATEGORIES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      objectCategory = body.object_category;
    }

    // Read the object inventory of a set of Rooms (M1 `objectInventory`) — the
    // count half of a pull. Every scope funnels through here: a Room passes its
    // own id, a Floor its Rooms' ids, the whole Sketch every Room's id. An empty
    // set is a valid zero inventory.
    async function readInventory(roomIds: string[]): Promise<ObjectInventory> {
      if (roomIds.length === 0) return objectInventory([]);
      const { data } = await supabase
        .from("room_objects")
        .select("category")
        .in("room_id", roomIds)
        .returns<{ category: ObjectCategory }[]>();
      return objectInventory(data ?? []);
    }

    const snap = await checkSnapshot(supabase, estimateId, body.updated_at_snapshot);
    if (!snap.ok) return snap.response;

    // The line item we're freezing into — `unit_price` recomputes the total.
    const { data: existing } = await supabase
      .from("estimate_line_items")
      .select("id, unit_price")
      .eq("id", itemId)
      .eq("estimate_id", estimateId)
      .maybeSingle<{ id: string; unit_price: number }>();
    if (!existing) {
      return NextResponse.json({ error: "line item not found" }, { status: 404 });
    }

    // Resolve job → Sketch → Floors with explicit queries (the RLS-scoped client
    // already bounds this to the caller's org; the job match bounds it to this
    // estimate). A Sketch is 1:1 with a job, and every scope's source must sit on
    // one of that Sketch's Floors — so a Room or Floor from another job can never
    // be pulled here.
    if (!estimate.job_id) {
      return NextResponse.json({ error: "estimate has no job" }, { status: 404 });
    }
    const { data: sketch } = await supabase
      .from("sketches")
      .select("id")
      .eq("job_id", estimate.job_id)
      .maybeSingle<{ id: string }>();
    if (!sketch) {
      return NextResponse.json({ error: "sketch not found" }, { status: 404 });
    }

    const { data: floors } = await supabase
      .from("floors")
      .select("id, name")
      .eq("sketch_id", sketch.id);
    const floorList = (floors ?? []) as Array<{ id: string; name: string }>;
    const floorIds = floorList.map((f) => f.id);
    if (floorIds.length === 0) {
      return NextResponse.json({ error: "sketch has no floors" }, { status: 404 });
    }

    const pulledAt = new Date().toISOString();

    // Resolve the frozen value + breadcrumb for the requested scope. Every branch
    // reads the same cached measurements and the same M3 resolver family, so a
    // Floor total and the whole-Sketch total freeze exactly as a Room does.
    let pull: { value: number; source: SketchSource };
    if (scope === "room") {
      if (typeof body.roomId !== "string" || !body.roomId.trim()) {
        return NextResponse.json({ error: "roomId is required" }, { status: 400 });
      }
      const { data: room } = await supabase
        .from("rooms")
        .select(`id, name, floor_id, ${MEASUREMENT_COLUMNS}`)
        .eq("id", body.roomId)
        .in("floor_id", floorIds)
        .maybeSingle<
          MeasurementRow & { id: string; name: string; floor_id: string }
        >();
      if (!room) {
        return NextResponse.json({ error: "room not found" }, { status: 404 });
      }
      if (objectCategory) {
        pull = resolveRoomObjectPull({
          inventory: await readInventory([room.id]),
          category: objectCategory,
          sketchId: sketch.id,
          floorId: room.floor_id,
          roomId: room.id,
          roomName: room.name,
          pulledAt,
        });
      } else {
        // One Room's counts: its own door/window tally (rooms: 1 for completeness).
        const { doors, windows } = openingCounts(room.openings);
        pull = resolveRoomPull({
          measurements: toMeasurements(room),
          counts: { rooms: 1, doors, windows },
          kind: kind as ScalarPullKind,
          sketchId: sketch.id,
          floorId: room.floor_id,
          roomId: room.id,
          roomName: room.name,
          pulledAt,
        });
      }
    } else if (scope === "floor") {
      if (typeof body.floorId !== "string" || !body.floorId.trim()) {
        return NextResponse.json({ error: "floorId is required" }, { status: 400 });
      }
      const floor = floorList.find((f) => f.id === body.floorId);
      if (!floor) {
        return NextResponse.json({ error: "floor not found" }, { status: 404 });
      }
      if (objectCategory) {
        // Count objects across every Room on this Floor: read the Floor's Room
        // ids, then their objects. `objectInventory` over the flat list equals
        // summing per-Room inventories (#867).
        const { data: floorRoomIds } = await supabase
          .from("rooms")
          .select("id")
          .eq("floor_id", floor.id)
          .returns<{ id: string }[]>();
        pull = resolveFloorObjectPull({
          inventory: await readInventory((floorRoomIds ?? []).map((r) => r.id)),
          category: objectCategory,
          sketchId: sketch.id,
          floorId: floor.id,
          floorName: floor.name,
          pulledAt,
        });
      } else {
        const { data: floorRooms } = await supabase
          .from("rooms")
          .select(MEASUREMENT_COLUMNS)
          .eq("floor_id", floor.id)
          .returns<MeasurementRow[]>();
        const aggregate = aggregateFloor((floorRooms ?? []).map(toContribution));
        pull = resolveFloorPull({
          measurements: aggregate.measurements,
          counts: aggregate.counts,
          kind: kind as ScalarPullKind,
          sketchId: sketch.id,
          floorId: floor.id,
          floorName: floor.name,
          pulledAt,
        });
      }
    } else {
      if (objectCategory) {
        // Whole-Sketch count: every Room across every Floor. Read all Room ids,
        // then their objects; `objectInventory` over the flat list is the total.
        const { data: allRoomIds } = await supabase
          .from("rooms")
          .select("id")
          .in("floor_id", floorIds)
          .returns<{ id: string }[]>();
        pull = resolveSketchObjectPull({
          inventory: await readInventory((allRoomIds ?? []).map((r) => r.id)),
          category: objectCategory,
          sketchId: sketch.id,
          pulledAt,
        });
      } else {
        // Whole-Sketch total: sum every Floor's Rooms. Summing all contributions
        // in one pass equals summing per-Floor then across Floors (addition is
        // associative), and only the measurements feed the freeze.
        const { data: allRooms } = await supabase
          .from("rooms")
          .select(MEASUREMENT_COLUMNS)
          .in("floor_id", floorIds)
          .returns<MeasurementRow[]>();
        const aggregate = aggregateFloor((allRooms ?? []).map(toContribution));
        pull = resolveSketchPull({
          measurements: aggregate.measurements,
          counts: aggregate.counts,
          kind: kind as ScalarPullKind,
          sketchId: sketch.id,
          pulledAt,
        });
      }
    }

    const { data, error } = await supabase
      .from("estimate_line_items")
      .update({
        quantity: pull.value,
        sketch_source: pull.source,
        total: round2(pull.value * existing.unit_price),
      })
      .eq("id", itemId)
      .eq("estimate_id", estimateId)
      .select("*")
      .single<EstimateLineItem>();
    if (error) {
      return apiDbError(
        error.message,
        "POST /api/estimates/[id]/line-items/[item_id]/pull update",
      );
    }

    await recalculateTotals(estimateId, supabase);

    const { data: parent } = await supabase
      .from("estimates")
      .select("updated_at")
      .eq("id", estimateId)
      .maybeSingle<{ updated_at: string }>();

    return NextResponse.json({ line_item: data, updated_at: parent?.updated_at ?? null });
  },
);
