import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { updateFloor } from "@/lib/sketch/update-floor";
import { apiDbError } from "@/lib/api-errors";

interface UpdateFloorPayload {
  name?: unknown;
}

// PATCH /api/jobs/[id]/sketch/floors/[floorId] — rename a Floor from the
// full-screen editor (#865). A plan carries named Floors ("Main House", "Second
// Floor", "Detached Garage"), so the only mutation here is the name. Like the
// rooms route it first confirms the URL's Floor is visible to the caller's org —
// a cross-org or nonexistent id resolves to no row under RLS and 404s, leaking no
// existence oracle — then writes the trimmed name.
export const PATCH = withRequestContext(
  { permission: "edit_jobs" },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; floorId: string }> },
  ) => {
    const { floorId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const { data: floor, error: floorError } = await ctx.supabase
      .from("floors")
      .select("id")
      .eq("id", floorId)
      .maybeSingle<{ id: string }>();
    if (floorError) {
      return apiDbError(
        floorError.message,
        "PATCH /api/jobs/[id]/sketch/floors/[floorId]",
      );
    }
    if (!floor) {
      return NextResponse.json({ error: "Floor not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as UpdateFloorPayload;
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 },
      );
    }

    try {
      const updated = await updateFloor(ctx.supabase, {
        floorId,
        name: body.name.trim(),
      });
      return NextResponse.json({ floor: updated }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "update failed",
        "PATCH /api/jobs/[id]/sketch/floors/[floorId]",
      );
    }
  },
);
