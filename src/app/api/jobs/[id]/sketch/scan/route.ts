import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { applyRoomScan } from "@/lib/sketch/apply-scan";
import { apiDbError } from "@/lib/api-errors";
import type { CapturedRoom } from "@/lib/mobile/roomplan-capture";

interface ScanPayload {
  /** The RoomPlan capture the native plugin serialized (roomplan-capture). */
  room?: unknown;
}

/**
 * The CapturedRoom contract at the wire boundary: an object carrying the five
 * surface arrays RoomPlan reports (walls/doors/windows/openings/objects). Their
 * per-surface contents are the plugin's own Codable output, so we check only that
 * the arrays are present — the mapper tolerates imperfect geometry (that's what the
 * editor pass is for), and an empty capture is valid (it still ensures the Sketch).
 */
function isCapturedRoom(value: unknown): value is CapturedRoom {
  if (typeof value !== "object" || value === null) return false;
  const room = value as Record<string, unknown>;
  return (
    Array.isArray(room.walls) &&
    Array.isArray(room.doors) &&
    Array.isArray(room.windows) &&
    Array.isArray(room.openings) &&
    Array.isArray(room.objects)
  );
}

// POST /api/jobs/[id]/sketch/scan — fill a Job's Sketch from a RoomPlan scan (#871).
// A scan is an INPUT to the Job's one Sketch (ADR 0025): this bootstraps the Sketch
// if needed, maps the capture (M11), and writes the resulting Room + objects server-
// side so the measurement cache stays app-written (applyRoomScan). Like the rooms
// route it first verifies the URL's Job is visible to the caller's org.
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

    // The URL Job must be visible to the caller's org. Under the RLS-scoped client
    // a cross-org or nonexistent id resolves to no row — both 404 identically,
    // leaking no existence oracle.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle<{ id: string }>();
    if (jobError) {
      return apiDbError(jobError.message, "POST /api/jobs/[id]/sketch/scan");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as ScanPayload;
    if (!isCapturedRoom(body.room)) {
      return NextResponse.json(
        { error: "A RoomPlan capture (room) is required" },
        { status: 400 },
      );
    }

    try {
      const result = await applyRoomScan(ctx.supabase, {
        organizationId: ctx.orgId,
        jobId,
        room: body.room,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "scan failed",
        "POST /api/jobs/[id]/sketch/scan",
      );
    }
  },
);
