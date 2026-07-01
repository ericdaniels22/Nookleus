import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createSketchFloor } from "@/lib/sketch/create-floor";
import { apiDbError } from "@/lib/api-errors";

interface CreateFloorPayload {
  name?: unknown;
}

// POST /api/jobs/[id]/sketch/floors — add a Floor to a Job's Sketch (#865). A
// Sketch grows from its bootstrap Floor into many (author multiple Floors; a
// detached structure is its own Floor). Like the rooms route (#446) it first
// verifies the URL's Job is visible to the caller's org, then resolves that Job's
// Sketch server-side — the client never names the Sketch, so a Floor can't be
// grafted onto another job's plan — and creates the Floor under it.
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

    // The URL Job must be visible to the caller's org. Under RLS a cross-org or
    // nonexistent id resolves to no row — both 404, leaking no existence oracle.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle<{ id: string }>();
    if (jobError) {
      return apiDbError(jobError.message, "POST /api/jobs/[id]/sketch/floors");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Resolve the Job's single Sketch (1:1 with the Job). Opening the builder
    // bootstraps it, so a missing Sketch here is the impossible case — guard it.
    const { data: sketch, error: sketchError } = await ctx.supabase
      .from("sketches")
      .select("id")
      .eq("job_id", jobId)
      .maybeSingle<{ id: string }>();
    if (sketchError) {
      return apiDbError(sketchError.message, "POST /api/jobs/[id]/sketch/floors");
    }
    if (!sketch) {
      return NextResponse.json({ error: "Sketch not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as CreateFloorPayload;
    const name =
      typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Floor";

    try {
      const floor = await createSketchFloor(ctx.supabase, {
        organizationId: ctx.orgId,
        sketchId: sketch.id,
        name,
      });
      return NextResponse.json({ floor }, { status: 201 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "insert failed",
        "POST /api/jobs/[id]/sketch/floors",
      );
    }
  },
);
