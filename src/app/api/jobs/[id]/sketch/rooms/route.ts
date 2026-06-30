import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createSketchRoom } from "@/lib/sketch/create-room";
import { apiDbError } from "@/lib/api-errors";

interface CreateRoomPayload {
  floorId?: unknown;
  name?: unknown;
  width?: unknown;
  length?: unknown;
  ceilingHeightOverride?: unknown;
}

/** A finite, non-negative number — the only kind a footprint dimension can be. */
function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// POST /api/jobs/[id]/sketch/rooms — add a rectangular Room to a Job's Sketch
// (#860). Runs server-side because the Room's cached measurements are computed
// there from M1 (createSketchRoom), keeping the app the single writer of the
// cache (migration-build88). Like the reports route (#446) it first verifies the
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

    // A Room needs a Floor to live on and a finite, non-negative footprint. The
    // ceiling height is optional — null means "inherit the Floor's default".
    const floorId = typeof body.floorId === "string" ? body.floorId : null;
    const ceilingHeightOverride = isDimension(body.ceilingHeightOverride)
      ? body.ceilingHeightOverride
      : null;
    if (!floorId || !isDimension(body.width) || !isDimension(body.length)) {
      return NextResponse.json(
        { error: "floorId, width and length are required" },
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
        width: body.width,
        length: body.length,
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
