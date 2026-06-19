import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { loadOpenSession } from "@/lib/time-sessions";

// GET /api/time/active — the caller's current Open Time session, or null
// (issue #701). Drives the app-wide "On the clock" status bar, which labels the
// session with its Job ("On 12 Maple St · …"), so the open session is enriched
// with the Job's address and number. Gated on `track_time`.
export const GET = withRequestContext({ permission: "track_time" }, async (_request, ctx) => {
  const open = await loadOpenSession(ctx.supabase, ctx.userId, ctx.orgId);
  if (!open) {
    return NextResponse.json({ active: null }, { status: 200 });
  }

  const { data: job } = await ctx.supabase
    .from("jobs")
    .select("job_number, property_address")
    .eq("id", open.jobId)
    .maybeSingle();
  const jobRow = job as { job_number: string; property_address: string } | null;

  return NextResponse.json(
    {
      active: {
        ...open,
        job: jobRow
          ? { job_number: jobRow.job_number, property_address: jobRow.property_address }
          : null,
      },
    },
    { status: 200 },
  );
});
