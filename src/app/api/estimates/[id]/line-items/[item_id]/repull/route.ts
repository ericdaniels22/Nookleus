import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { checkSnapshot, recalculateTotals } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { round2 } from "@/lib/format";
import type { EstimateLineItem, SketchOpening, SketchSource } from "@/lib/types";
import type { RoomMeasurements } from "@/lib/sketch/measure-room";
import type { SketchCounts } from "@/lib/sketch/aggregate";
import {
  resolveRoomRepull,
  type RoomSketchSource,
} from "@/lib/sketch/pull-resolver";
import type { SupabaseClient } from "@supabase/supabase-js";

interface RouteCtx {
  params: Promise<{ id: string; item_id: string }>;
}

interface RepullBody {
  /** When true, the confirmed re-pull is applied (writes). Otherwise a dry-run preview. */
  apply?: unknown;
  /**
   * The `new_value` the user confirmed in the preview. On apply the route
   * re-resolves the live measurement and refuses (409) if it has drifted from
   * this, so a value the user never approved can never be frozen silently.
   */
  expected_new_value?: unknown;
  updated_at_snapshot?: string;
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

/**
 * Read the *current* measurements AND door/window counts of the Room a frozen
 * `sketch_source` points at, walking THIS estimate's job → Sketch → Floors → Room
 * exactly as the pull route does. The counts are needed to re-pull a count kind
 * (#866); a measurement-kind re-pull ignores them. Returns `null` when the Room
 * (or its Floor/Sketch) no longer exists — the re-pull's "deleted source" signal
 * (#864 AC #4). Scoping through the current job's Sketch means a Sketch that was
 * deleted and recreated (new ids) reads as missing too: the frozen `room_id` is no
 * longer under this estimate's Sketch.
 */
async function readSourceRoom(
  supabase: SupabaseClient,
  jobId: string | null,
  source: RoomSketchSource,
): Promise<{ measurements: RoomMeasurements; counts: SketchCounts } | null> {
  if (!jobId) return null;

  const { data: sketch } = await supabase
    .from("sketches")
    .select("id")
    .eq("job_id", jobId)
    .maybeSingle<{ id: string }>();
  if (!sketch) return null;

  const { data: floors } = await supabase
    .from("floors")
    .select("id")
    .eq("sketch_id", sketch.id);
  const floorIds = (floors ?? []).map((f: { id: string }) => f.id);
  if (floorIds.length === 0) return null;

  const { data: room } = await supabase
    .from("rooms")
    .select(
      "id, floor_area, ceiling_area, perimeter, gross_wall_area, net_wall_area, volume, openings",
    )
    .eq("id", source.room_id)
    .in("floor_id", floorIds)
    .maybeSingle<{
      id: string;
      floor_area: number | string;
      ceiling_area: number | string;
      perimeter: number | string;
      gross_wall_area: number | string;
      net_wall_area: number | string;
      volume: number | string;
      openings: SketchOpening[] | null;
    }>();
  if (!room) return null;

  // PostgREST returns numerics as strings — coerce back to the numbers M1/M3
  // reason about. These are the live cached measurements, re-read now.
  const { doors, windows } = openingCounts(room.openings);
  return {
    measurements: {
      floorArea: Number(room.floor_area),
      ceilingArea: Number(room.ceiling_area),
      perimeter: Number(room.perimeter),
      grossWallArea: Number(room.gross_wall_area),
      netWallArea: Number(room.net_wall_area),
      volume: Number(room.volume),
    },
    counts: { rooms: 1, doors, windows },
  };
}

/**
 * POST /api/estimates/[id]/line-items/[item_id]/repull — the re-pull half of the
 * snapshot contract (#864, S3; ADR 0025). A Sketch-sourced line item is refreshed
 * from the *live* Sketch, but only on an explicit user action and only after they
 * have seen old-vs-new.
 *
 * Two phases share one resolution path, gated by the `apply` flag:
 *   - preview (`apply` falsy): re-read the source Room, return `{ old_value,
 *     new_value, changed, room_name, kind }`. Writes nothing.
 *   - apply (`apply: true`): recompute + persist the refreshed `quantity` /
 *     `sketch_source` (new value + `pulled_at`) / `total`, then recalc totals.
 *
 * Unlike the pull route, the source Room + measurement kind are NOT taken from the
 * request — they come from the line item's own frozen `sketch_source`, so a re-pull
 * always refreshes the same source it was pulled from. If that source Room no longer
 * exists, re-pull fails cleanly (409) and the frozen quantity is left untouched —
 * a deleted source never corrupts a built estimate.
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

    let body: RepullBody;
    try {
      body = (await request.json()) as RepullBody;
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const apply = body.apply === true;

    // The line item we're re-pulling — its frozen `sketch_source` names the source
    // Room + kind; `unit_price` recomputes the total on apply.
    const { data: existing } = await supabase
      .from("estimate_line_items")
      .select("id, quantity, unit_price, sketch_source")
      .eq("id", itemId)
      .eq("estimate_id", estimateId)
      .maybeSingle<{
        id: string;
        quantity: number | string;
        unit_price: number;
        sketch_source: SketchSource | null;
      }>();
    if (!existing) {
      return NextResponse.json({ error: "line item not found" }, { status: 404 });
    }

    const source = existing.sketch_source;
    if (!source) {
      return NextResponse.json(
        { error: "line item has no Sketch source to re-pull" },
        { status: 400 },
      );
    }
    // Re-pull is Room-scoped only (#864 predates the Floor/Sketch pull scopes).
    // A Floor- or Sketch-sourced line has no single Room to re-read; the client
    // re-picks it through the pull picker instead. Reject rather than guess.
    if (source.scope !== "room") {
      return NextResponse.json(
        {
          error:
            "Re-pull is only supported for Room-scoped line items. Use “Change source” to re-pick a Floor or whole-Sketch total.",
        },
        { status: 400 },
      );
    }

    // Only the mutating apply is guarded against a stale estimate snapshot; the
    // preview is read-only (mirrors the pull route, which opts out when no
    // snapshot is supplied).
    if (apply) {
      const snap = await checkSnapshot(supabase, estimateId, body.updated_at_snapshot);
      if (!snap.ok) return snap.response;
    }

    const live = await readSourceRoom(supabase, estimate.job_id, source);

    const resolution = resolveRoomRepull({
      source,
      measurements: live?.measurements ?? null,
      counts: live?.counts,
      currentQuantity: Number(existing.quantity),
      pulledAt: new Date().toISOString(),
    });

    if (resolution.status === "source-missing") {
      // AC #4: the source Room is gone — fail cleanly, write nothing, leave the
      // frozen quantity intact. A deleted source never corrupts a built estimate.
      return NextResponse.json(
        {
          error:
            "The Sketch Room this line item was pulled from no longer exists. Its quantity was left unchanged.",
        },
        { status: 409 },
      );
    }

    if (!apply) {
      // Preview (AC #2): old-vs-new, no mutation.
      return NextResponse.json({
        preview: {
          old_value: resolution.oldValue,
          new_value: resolution.newValue,
          changed: resolution.changed,
          room_name: source.room_name,
          kind: source.kind,
        },
      });
    }

    // Guard the confirm against measurement drift (AC #2 — nothing changes
    // silently). If the client echoes the value it previewed and the live
    // measurement has since moved (a concurrent Sketch edit during the confirm
    // window), refuse rather than freeze a number the user never approved, and
    // hand back the fresh value so they can re-review.
    if (
      typeof body.expected_new_value === "number" &&
      body.expected_new_value !== resolution.newValue
    ) {
      return NextResponse.json(
        {
          error:
            "The Sketch changed since you previewed this re-pull. Re-pull again to review the new value.",
          preview: {
            old_value: resolution.oldValue,
            new_value: resolution.newValue,
            changed: resolution.changed,
            room_name: source.room_name,
            kind: source.kind,
          },
        },
        { status: 409 },
      );
    }

    // Apply (AC #3): freeze the refreshed value + source + total.
    const { data, error } = await supabase
      .from("estimate_line_items")
      .update({
        quantity: resolution.newValue,
        sketch_source: resolution.source,
        total: round2(resolution.newValue * existing.unit_price),
      })
      .eq("id", itemId)
      .eq("estimate_id", estimateId)
      .select("*")
      .single<EstimateLineItem>();
    if (error) {
      return apiDbError(
        error.message,
        "POST /api/estimates/[id]/line-items/[item_id]/repull update",
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
