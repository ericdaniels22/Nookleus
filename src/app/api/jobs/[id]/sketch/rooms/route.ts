import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createSketchRoom } from "@/lib/sketch/create-room";
import { apiDbError } from "@/lib/api-errors";

interface CreateRoomPayload {
  floorId?: unknown;
  name?: unknown;
  footprint?: unknown;
  ceilingHeightOverride?: unknown;
}

/** A finite, non-negative number — the only kind a ceiling height can be. */
function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * A drawable footprint: an ordered loop of at least three corners, each a point
 * with finite x/y. Fewer than three corners can't enclose a Room (#879). Corner
 * coordinates may be any finite number — the grid origin is arbitrary and the
 * shoelace area is sign-independent.
 */
function isFootprint(value: unknown): value is { x: number; y: number }[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.every(
      (p): p is { x: number; y: number } =>
        typeof p === "object" &&
        p !== null &&
        Number.isFinite((p as { x: unknown }).x) &&
        Number.isFinite((p as { y: unknown }).y),
    )
  );
}

// POST /api/jobs/[id]/sketch/rooms — add a Room to a Job's Sketch (#860, #879).
// Runs server-side because the Room's cached measurements are computed there from
// M1 (createSketchRoom), keeping the app the single writer of the cache
// (migration-build88/89). Like the reports route (#446) it first verifies the
// URL's Job is visible to the caller's org before writing anything for it.
export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    // The URL Job must be visible to the caller's org. Under the RLS-scoped
    // client a cross-org or nonexistent id resolves to no row — both 404
    // identically, leaking no existence oracle.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle<{ id: string }>();
    if (jobError) {
      return apiDbError(jobError.message, "POST /api/jobs/[id]/sketch/rooms");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = (await request
      .json()
      .catch(() => ({}))) as CreateRoomPayload;

    // A Room needs a Floor to live on and a drawn footprint of at least three
    // corners. The ceiling height is optional — null means "inherit the Floor's
    // default".
    const floorId = typeof body.floorId === "string" ? body.floorId : null;
    const ceilingHeightOverride = isDimension(body.ceilingHeightOverride)
      ? body.ceilingHeightOverride
      : null;
    if (!floorId || !isFootprint(body.footprint)) {
      return NextResponse.json(
        { error: "floorId and a footprint of at least three corners are required" },
        { status: 400 },
      );
    }
    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Room";

    try {
      const room = await createSketchRoom(ctx.supabase, {
        organizationId: ctx.orgId,
        floorId,
        name,
        footprint: body.footprint,
        ceilingHeightOverride,
      });
      return NextResponse.json({ room }, { status: 201 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "insert failed",
        "POST /api/jobs/[id]/sketch/rooms",
      );
    }
  },
);
