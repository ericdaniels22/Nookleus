import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/time/sessions?jobId=… — the caller's OWN recorded Time sessions for
// a Job (issue #701). A worker only ever sees their own hours; that filter is
// applied here at the app layer (RLS only backstops Organization isolation).
// Gated on `track_time`.
export const GET = withRequestContext({ permission: "track_time" }, async (request, ctx) => {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  // OWN hours only: filter on the caller's own user_id at the app layer. Most
  // recent first so the live (open) session leads the list.
  const { data, error } = await ctx.supabase
    .from("time_sessions")
    .select("id, job_id, started_at, ended_at, capture_method")
    .eq("user_id", ctx.userId)
    .eq("organization_id", ctx.orgId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sessions = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    sessionId: row.id as string,
    jobId: row.job_id as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    // The capture marker (#706, AC4) — 'live' vs 'hand'. The client renders a
    // visible "Hand-entered" marker for a hand-entered/corrected session.
    capture: row.capture_method as string,
  }));
  return NextResponse.json({ sessions }, { status: 200 });
});
