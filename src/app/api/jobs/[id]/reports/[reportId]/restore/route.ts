// POST /api/jobs/[id]/reports/[reportId]/restore — pull a Photo Report back out
// of the trash (#402). Clears photo_reports.deleted_at so the report returns to
// the Job Overview's active list. Mirrors the Job restore route and is
// idempotent: restoring an already-active report is a no-op.

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

    const { error } = await ctx.supabase
      .from("photo_reports")
      .update({ deleted_at: null })
      .eq("id", reportId)
      .eq("job_id", jobId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
