// src/lib/time-sessions.ts — the thin I/O layer for a worker's Time sessions.
//
// The pure lifecycle rules live in session-lifecycle.ts; this module loads the
// one piece of state those rules need — the worker's current Open session — so
// a route can hand it to planClockIn / planClockOut. Kept separate so the rules
// stay free of Supabase.
//
// Timestamps are ISO-8601 UTC instants (ADR 0020).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpenSession } from "@/lib/session-lifecycle";

// Load the caller's current Open session (ended_at IS NULL, not soft-deleted),
// or null if they are not On the clock. At most one row can match — the partial
// unique index on time_sessions pins one open session per worker — so a load
// error degrades safely to null: any real double-open is still rejected by that
// index at write time. `orgId` is `string | null` to match the Request Context
// shape; a null org trivially has no Open session (the permission-gated callers
// always pass a real org).
export async function loadOpenSession(
  supabase: SupabaseClient,
  userId: string,
  orgId: string | null,
): Promise<OpenSession | null> {
  const { data } = await supabase
    .from("time_sessions")
    .select("id, job_id, started_at")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .is("ended_at", null)
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .maybeSingle();
  const row = data as { id: string; job_id: string; started_at: string } | null;
  return row
    ? { sessionId: row.id, jobId: row.job_id, startedAt: row.started_at }
    : null;
}
