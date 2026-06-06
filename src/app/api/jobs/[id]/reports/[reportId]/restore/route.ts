// POST /api/jobs/[id]/reports/[reportId]/restore — pull a Photo Report back out
// of the trash (#402). Clears photo_reports.deleted_at so the report returns to
// the Job Overview's active list. Mirrors the Job restore route and is
// idempotent: restoring an already-active report is a no-op.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; reportId: string }> },
  ) => {
    const { id: jobId, reportId } = await params;

    // We only restore rows currently in the trash — `.not("deleted_at", "is",
    // null)` makes restoring an already-active report a no-op. The
    // `.select().maybeSingle()` distinguishes a real DB error from "no trashed
    // row matched", which 404s instead of falsely reporting success. Mirrors the
    // referral-partners restore shape.
    const { data, error } = await ctx.supabase
      .from("photo_reports")
      .update({ deleted_at: null })
      .eq("id", reportId)
      .eq("job_id", jobId)
      .not("deleted_at", "is", null)
      .select("id")
      .maybeSingle();
    if (error) {
      // Restoring re-adds the row to the active set, so it can collide with the
      // partial unique index on (job_id, report_number) when a *different*
      // active report already holds this number — only reachable for a
      // pre-existing duplicate left over from before that index shipped
      // (migration 412). Surface that as an actionable 409 rather than an opaque
      // 500 (#447 #8); the operator renumbers the conflict before restoring.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "Another active report already uses this number on this Job. Renumber it before restoring.",
          },
          { status: 409 },
        );
      }
      return apiDbError(
        error.message,
        "POST /api/jobs/[id]/reports/[reportId]/restore",
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Photo Report not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  },
);
