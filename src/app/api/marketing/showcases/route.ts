// GET /api/marketing/showcases — the Marketing area's Showcases tab (#613).
//
// Two lists, both Organization-scoped (RLS via the User client) and admin-only,
// matching every other Showcase surface:
//   * `showcases` — the Org's live (non-trashed) Showcases, newest-touched first;
//   * `nudges`    — recently-completed Jobs that still have no live Showcase,
//                   the "you completed this, tell its story" prompt.
//
// The nudge is the pure `completedJobsWithoutShowcase` selector: the route
// fetches the completed Jobs and the set of Job ids that already have a live
// Showcase, then passes the Job's `updated_at` as the `completedAt` proxy (Jobs
// carry no completed_at) and the request time as a fixed `now`.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import {
  completedJobsWithoutShowcase,
  type NudgeJob,
} from "@/lib/showcase-nudge";

// A completed Job row carrying the columns the tab renders, plus the
// `updated_at` the selector reads through `completedAt`.
interface CompletedJobRow {
  id: string;
  status: string;
  updated_at: string;
  job_number: string | null;
  contact?: { full_name: string | null } | null;
}

export const GET = withRequestContext(
  { adminOnly: true },
  async (_request, ctx) => {
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    // Live Showcases only — a trashed one frees the Job to be nudged again, so
    // it must not count as "has a Showcase" below. Joined to the Job for the
    // card's title/number; RLS already scopes to the active Org.
    const { data: showcaseRows, error: showcaseError } = await ctx.supabase
      .from("showcases")
      .select(
        "*, job:jobs!job_id(id, job_number, contact:contacts!contact_id(full_name))",
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (showcaseError) {
      return apiDbError(showcaseError.message, "GET /api/marketing/showcases");
    }
    const showcases = showcaseRows ?? [];

    // Completed Jobs are the only nudge candidates; pull the few display columns
    // the selector and the card need. The selector re-checks status + recency.
    const { data: jobRows, error: jobsError } = await ctx.supabase
      .from("jobs")
      .select(
        "id, job_number, status, updated_at, contact:contacts!contact_id(full_name)",
      )
      .eq("status", "completed")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .returns<CompletedJobRow[]>();
    if (jobsError) {
      return apiDbError(jobsError.message, "GET /api/marketing/showcases");
    }

    const showcasedJobIds = showcases.map(
      (s) => (s as { job_id: string }).job_id,
    );
    const nudgeJobs = (jobRows ?? []).map((j) => ({
      ...j,
      completedAt: j.updated_at,
    }));
    const nudges = completedJobsWithoutShowcase<CompletedJobRow & NudgeJob>(
      nudgeJobs,
      showcasedJobIds,
      { now: new Date().toISOString() },
    );

    return NextResponse.json({ showcases, nudges });
  },
);
