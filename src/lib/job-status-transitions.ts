// src/lib/job-status-transitions.ts
//
// The one automatic Job-status move (PRD #719, ADR 0022, issue #721):
// finalizing a signed contract advances a Lead or a Lost Job to Active.
// Signing never moves a Job backward — an Active, Collections, or Closed Job
// is left untouched. The snake_case keys are FROZEN (ADR 0022); this module
// branches on keys, never labels.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The status a Job should move to when its contract is finalized as signed,
 * or `null` when signing must NOT change the status.
 */
export function nextStatusOnContractSigned(current: string): string | null {
  return current === "new" || current === "cancelled" ? "in_progress" : null;
}

/**
 * Apply the signed-contract auto-advance to a Job, in place. Reads the Job's
 * *live* status (the contract snapshot may be stale), applies
 * {@link nextStatusOnContractSigned}, and writes only when there is a move to
 * make. Returns the status it advanced to, or `null` when it left the Job
 * unchanged (already Active/Collections/Closed, missing job, or no jobId).
 *
 * The write re-asserts the just-read status in its filter, so the database
 * applies the guard atomically: if a concurrent writer (the manual status
 * dropdown, or a sibling signing) has moved the Job in the read→write window,
 * the update matches zero rows and the Job is left untouched. Signing can
 * therefore never clobber a Job backward, even under a race.
 */
export async function advanceJobOnContractSigned(
  supabase: SupabaseClient,
  jobId: string | null | undefined,
): Promise<string | null> {
  if (!jobId) return null;

  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle<{ status: string }>();
    if (error || !data) return null;

    const next = nextStatusOnContractSigned(data.status);
    if (!next) return null;

    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update({ status: next })
      .eq("id", jobId)
      .eq("status", data.status)
      .select("status")
      .maybeSingle<{ status: string }>();
    if (updateError) {
      console.error(
        `[job-status] auto-advance update failed for job ${jobId}:`,
        updateError.message,
      );
      return null;
    }
    return updated ? next : null;
  } catch (e) {
    console.error(
      `[job-status] auto-advance threw for job ${jobId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}
