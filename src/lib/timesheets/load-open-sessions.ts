// load-open-sessions — the read-side of Presence (#705, epic #699).
//
// Resolves an Organization (optionally one Job) to the live list of app Users
// On the clock: their open `time_sessions`, each shaped with the worker's
// display name and the Job. Feeds both the per-Job "On site now" indicator and
// the owner-dashboard org-wide "On the clock now" roll-up; the realtime hook
// (`use-open-sessions`) re-runs it on every relevant `time_sessions` event.
//
// Contract (enforced here, not assumed of the caller):
//   - OPEN only — ended_at IS NULL, not soft-deleted
//   - APP Users only — Off-app workers (a typed name, no user_id) never appear
//   - one Organization (cross-org isolation), optionally one Job
//
// Timestamps are ISO-8601 UTC instants (ADR 0020). No GPS/location (ADR 0019).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OpenSessionPresence {
  sessionId: string;
  userId: string;
  jobId: string;
  /** Clock-in instant; the surfaces count a live elapsed timer up from this. */
  startedAt: string;
  /** The app User's display name (user_profiles.full_name); null if unset. */
  workerName: string | null;
  /** The Job they're on, for the dashboard roll-up; null if the row's job is unreadable. */
  job: { jobNumber: string | null; propertyAddress: string | null } | null;
}

// PostgREST returns a to-one embed as an object, but supabase-js types it as
// possibly an array — normalise both (mirrors settings/users route).
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed ?? null;
}

interface OpenSessionRow {
  id: string;
  user_id: string | null;
  job_id: string;
  started_at: string;
  ended_at: string | null;
  deleted_at: string | null;
  user_profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  jobs:
    | { job_number: string | null; property_address: string | null }
    | { job_number: string | null; property_address: string | null }[]
    | null;
}

export async function loadOpenSessions(
  supabase: SupabaseClient,
  opts: { organizationId: string; jobId?: string },
): Promise<OpenSessionPresence[]> {
  let query = supabase
    .from("time_sessions")
    .select(
      "id, user_id, job_id, started_at, ended_at, deleted_at, " +
        "user_profiles:user_id(full_name), jobs:job_id(job_number, property_address)",
    )
    .eq("organization_id", opts.organizationId)
    .is("ended_at", null)
    .is("deleted_at", null)
    // Off-app workers have a null user_id — exclude them at the source.
    .not("user_id", "is", null)
    .order("started_at", { ascending: true });

  if (opts.jobId) query = query.eq("job_id", opts.jobId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // PostgREST types embedded-join selects as a union that includes a parse-error
  // shape, so narrow through `unknown` to our row type (error already thrown above).
  const rows = (data ?? []) as unknown as OpenSessionRow[];
  return rows
    // Defensive: the contract holds even if a row slips the DB filters.
    .filter((r) => r.user_id && !r.ended_at && !r.deleted_at)
    .map((r) => {
      const profile = one(r.user_profiles);
      const job = one(r.jobs);
      return {
        sessionId: r.id,
        userId: r.user_id as string,
        jobId: r.job_id,
        startedAt: r.started_at,
        workerName: profile?.full_name ?? null,
        job: job
          ? {
              jobNumber: job.job_number ?? null,
              propertyAddress: job.property_address ?? null,
            }
          : null,
      };
    });
}
