// POST /api/jobs/[id]/reports/[reportId]/delete — move a Photo Report to the
// recoverable trash (#402). Sets photo_reports.deleted_at = now(); the row
// stays in the DB and drops out of the Job Overview's active list until it is
// restored. Mirrors the Job soft-delete route. Gated like the report create
// route (`edit_jobs`). Job CASCADE delete still hard-removes the row.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; reportId: string }> },
  ) => {
    const { id: jobId, reportId } = await params;

    // Scope by job_id as well as id so a report can only be trashed through its
    // own Job, and `.is("deleted_at", null)` keeps the write to active rows
    // (re-deleting an already-trashed report is a no-op, never a re-stamp).
    const { error } = await ctx.supabase
      .from("photo_reports")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("job_id", jobId)
      .is("deleted_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
