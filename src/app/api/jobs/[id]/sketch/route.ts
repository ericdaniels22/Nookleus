import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { deleteSketch } from "@/lib/sketch/delete-sketch";
import { apiDbError } from "@/lib/api-errors";

// DELETE /api/jobs/[id]/sketch — delete a Job's whole Sketch (#869, S9): the
// full-screen editor's "start over". Like the floors route (#865) it first
// verifies the URL's Job is visible to the caller's org, then resolves that Job's
// 1:1 Sketch server-side — the client never names the Sketch — and deletes it.
// The Sketch owns its Floors and Rooms (and, when they land, openings/objects)
// through ON DELETE CASCADE (migration-build88), so the DB removes the whole plan
// and the stored mesh goes with the row. Line items sourced from the Sketch are
// unaffected: their `sketch_source` is a frozen jsonb snapshot with no FK
// (ADR 0004), so quantities survive and a later re-pull fails cleanly.
export const DELETE = withRequestContext(
  { permission: "edit_jobs" },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
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
      return apiDbError(jobError.message, "DELETE /api/jobs/[id]/sketch");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Resolve the Job's single Sketch (1:1 with the Job). Opening the builder
    // bootstraps it, so a missing Sketch here means nothing to delete — 404.
    const { data: sketch, error: sketchError } = await ctx.supabase
      .from("sketches")
      .select("id")
      .eq("job_id", jobId)
      .maybeSingle<{ id: string }>();
    if (sketchError) {
      return apiDbError(sketchError.message, "DELETE /api/jobs/[id]/sketch");
    }
    if (!sketch) {
      return NextResponse.json({ error: "Sketch not found" }, { status: 404 });
    }

    try {
      await deleteSketch(ctx.supabase, { sketchId: sketch.id });
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "delete failed",
        "DELETE /api/jobs/[id]/sketch",
      );
    }
  },
);
