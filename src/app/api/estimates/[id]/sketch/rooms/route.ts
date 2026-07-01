import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import type { RoomMeasurements } from "@/lib/sketch/measure-room";
import {
  ROOM_MEASUREMENT_KINDS,
  roomMeasurementValue,
  type RoomMeasurementKind,
} from "@/lib/sketch/pull-resolver";

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
      return NextResponse.json({ rooms: [] });
    }

    const { data: sketch } = await supabase
      .from("sketches")
      .select("id")
      .eq("job_id", estimate.job_id)
      .maybeSingle<{ id: string }>();
    if (!sketch) {
      return NextResponse.json({ rooms: [] });
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
      return NextResponse.json({ rooms: [] });
    }

    const { data: rooms, error: roomsError } = await supabase
      .from("rooms")
      .select(
        "id, name, floor_id, floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume",
      )
      .in("floor_id", floorIds);
    if (roomsError) {
      return apiDbError(roomsError.message, "GET /api/estimates/[id]/sketch/rooms rooms");
    }

    const payload = (rooms ?? []).map((room: RoomRow) => {
      // PostgREST returns numerics as strings — coerce, then project the cached
      // measurements onto the pull kinds via the same M3 mapping the freeze uses.
      const measurements: RoomMeasurements = {
        floorArea: Number(room.floor_area),
        ceilingArea: Number(room.ceiling_area),
        perimeter: Number(room.perimeter),
        grossWallArea: Number(room.gross_wall_area),
        netWallArea: Number(room.net_wall_area),
        volume: Number(room.volume),
      };
      const byKind = {} as Record<RoomMeasurementKind, number>;
      for (const kind of ROOM_MEASUREMENT_KINDS) {
        byKind[kind] = roomMeasurementValue(measurements, kind);
      }
      return {
        id: room.id,
        name: room.name,
        floor_id: room.floor_id,
        floor_name: floorNameById.get(room.floor_id) ?? "",
        measurements: byKind,
      };
    });

    return NextResponse.json({ rooms: payload });
  },
);
