import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { checkSnapshot, recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { round2 } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";
import type { RoomMeasurements } from "@/lib/sketch/measure-room";
import {
  ROOM_MEASUREMENT_KINDS,
  resolveRoomPull,
  type RoomMeasurementKind,
} from "@/lib/sketch/pull-resolver";

interface RouteCtx {
  params: Promise<{ id: string; item_id: string }>;
}

interface PullBody {
  roomId?: unknown;
  kind?: unknown;
  updated_at_snapshot?: string;
}

function isKind(value: unknown): value is RoomMeasurementKind {
  return (
    typeof value === "string" &&
    (ROOM_MEASUREMENT_KINDS as readonly string[]).includes(value)
  );
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

    if (typeof body.roomId !== "string" || !body.roomId.trim()) {
      return NextResponse.json({ error: "roomId is required" }, { status: 400 });
    }
    if (!isKind(body.kind)) {
      return NextResponse.json(
        { error: `kind must be one of ${ROOM_MEASUREMENT_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    const roomId = body.roomId;
    const kind = body.kind;

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

    // Resolve job → Sketch → Floors → Room with explicit queries (the RLS-scoped
    // client already bounds this to the caller's org; the job match bounds it to
    // this estimate). A Sketch is 1:1 with a job; a Room must sit on one of that
    // Sketch's floors, so a Room from another job can never be pulled here.
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
      .select("id")
      .eq("sketch_id", sketch.id);
    const floorIds = (floors ?? []).map((f: { id: string }) => f.id);
    if (floorIds.length === 0) {
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    }

    const { data: room } = await supabase
      .from("rooms")
      .select(
        "id, name, floor_id, floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume",
      )
      .eq("id", roomId)
      .in("floor_id", floorIds)
      .maybeSingle<{
        id: string;
        name: string;
        floor_id: string;
        floor_area: number | string;
        ceiling_area: number | string;
        perimeter: number | string;
        gross_wall_area: number | string;
        net_wall_area: number | string;
        volume: number | string;
      }>();
    if (!room) {
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    }

    // PostgREST returns numerics as strings — coerce back to the numbers M1/M3
    // reason about. These are the cached measurements written by createSketchRoom
    // (M1's single writer); no recompute happens at pull time.
    const measurements: RoomMeasurements = {
      floorArea: Number(room.floor_area),
      ceilingArea: Number(room.ceiling_area),
      perimeter: Number(room.perimeter),
      grossWallArea: Number(room.gross_wall_area),
      netWallArea: Number(room.net_wall_area),
      volume: Number(room.volume),
    };

    const pull = resolveRoomPull({
      measurements,
      kind,
      sketchId: sketch.id,
      floorId: room.floor_id,
      roomId: room.id,
      roomName: room.name,
      pulledAt: new Date().toISOString(),
    });

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
