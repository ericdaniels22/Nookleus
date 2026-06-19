import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/time/clockable-jobs — the Active Jobs a worker can clock into, plus
// the worker's recently-clocked Job ids so the active-Job picker can surface
// them first (issue #701). "Active" means alive: status neither `completed`
// nor `cancelled`, and not trashed (CONTEXT.md "Active job"). The picker filters
// and ranks by the typed query client-side via rankPickerJobs, so this endpoint
// returns the full candidate list (the customer name comes along for the
// name-search) and the recency order, not a pre-filtered slice.
// Gated on `track_time`.

interface JobRow {
  id: string;
  job_number: string;
  property_address: string;
  // PostgREST returns a to-one embed as an object, but can surface it as a
  // one-element array; normalize both to a single { full_name } or null.
  contact: { full_name: string } | { full_name: string }[] | null;
}

function normalizeContact(
  contact: JobRow["contact"],
): { full_name: string } | null {
  const one = Array.isArray(contact) ? contact[0] : contact;
  return one ? { full_name: one.full_name } : null;
}

export const GET = withRequestContext({ permission: "track_time" }, async (_request, ctx) => {
  const { data: jobsData, error: jobsError } = await ctx.supabase
    .from("jobs")
    .select("id, job_number, property_address, contact:contacts(full_name)")
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .not("status", "eq", "completed")
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false });
  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const jobs = ((jobsData ?? []) as unknown as JobRow[]).map((j) => ({
    id: j.id,
    job_number: j.job_number,
    property_address: j.property_address,
    contact: normalizeContact(j.contact),
  }));

  // The worker's own sessions, most recent first; dedupe to the distinct Job
  // ids in recency order. RLS backstops Organization isolation; the explicit
  // user_id filter keeps a worker to their OWN recency (never a coworker's).
  const { data: recentData, error: recentError } = await ctx.supabase
    .from("time_sessions")
    .select("job_id")
    .eq("user_id", ctx.userId)
    .eq("organization_id", ctx.orgId)
    .is("deleted_at", null)
    .order("started_at", { ascending: false });
  if (recentError) {
    return NextResponse.json({ error: recentError.message }, { status: 500 });
  }

  const recentJobIds: string[] = [];
  for (const row of (recentData ?? []) as { job_id: string }[]) {
    if (!recentJobIds.includes(row.job_id)) {
      recentJobIds.push(row.job_id);
    }
  }

  return NextResponse.json({ jobs, recentJobIds }, { status: 200 });
});
