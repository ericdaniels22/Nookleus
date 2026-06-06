// PUT /api/jobs/[id]/reports/[reportId] — keepalive-capable content write path
// for the Photo Report builder (#478). The builder autosaves on a debounce; when
// the page goes away "the hard way" (tab close / refresh / app-background) a
// pending edit must still flush. The Supabase JS client can't ride a
// `keepalive: true` request, so the builder fires a plain keepalive PUT at this
// route instead (#479 wires the trigger). Persists title / report_date /
// sections with the same `edit_jobs` gate and (id, job_id, active) tenancy
// scoping as the delete/restore siblings — validated server-side, never trusting
// client-assembled auth.
//
// Architectural decision (#478, HITL): a server route via `withRequestContext`
// was chosen over a direct PostgREST keepalive fetch so tenancy/permission
// gating stays server-side and unit-testable, mirroring the Estimate/Invoice
// flush path (#477). See the issue thread for the recorded rationale.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

interface UpdatePayload {
  title?: string;
  report_date?: string;
  sections?: unknown[];
}

export const PUT = withRequestContext(
  { permission: "edit_jobs" },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; reportId: string }> },
  ) => {
    const { id: jobId, reportId } = await params;
    const body = (await request.json()) as UpdatePayload;

    // Whitelist the three editable content columns; only keys actually present
    // in the body are written, so a partial flush never clobbers a field the
    // client didn't send.
    const update: Record<string, unknown> = {};
    for (const k of ["title", "report_date", "sections"] as const) {
      if (k in body && body[k] !== undefined) update[k] = body[k];
    }

    // Scope by job_id as well as id so a report is only writable through its own
    // Job, and `.is("deleted_at", null)` keeps the write to active rows (a
    // trashed report is not editable). `.select().maybeSingle()` tells a real DB
    // error apart from "no row matched" — the latter 404s instead of falsely
    // reporting success. Mirrors the delete/restore sibling shape.
    const { data, error } = await ctx.supabase
      .from("photo_reports")
      .update(update)
      .eq("id", reportId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return apiDbError(
        error.message,
        "PUT /api/jobs/[id]/reports/[reportId]",
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
