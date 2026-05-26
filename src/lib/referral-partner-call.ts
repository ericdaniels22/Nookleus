// Pure logic behind the Call log (PRD #249, issue #254).
//
// Two responsibilities, both I/O-free so they can be unit-tested in
// isolation, exactly like `referral-partner-form.ts` and
// `referral-partner-filter.ts`:
//
//   1. The outcome enum constants — `CALL_OUTCOMES` — match the
//      `referral_partner_calls.outcome` check-constraint from build78 and
//      drive the "Log a call" dropdown.
//
//   2. The **call-log denormalization rule** — given the full set of a
//      partner's `referral_partner_calls` rows, return the three columns
//      that get written back onto the parent `referral_partners` row so
//      list-page queries like "show me partners I haven't called in N
//      days" or "what's overdue?" remain O(1) instead of joining the call
//      log on every read.
//
// The denormalization contract is what makes the whole feature's
// list-page sort/filter work — issue #254 calls it "load-bearing." Every
// branch is pinned by a unit test.

/** Every outcome the schema's check-constraint allows, in display order
 *  for the "Log a call" dropdown. */
export const CALL_OUTCOMES = [
  "no_answer",
  "voicemail",
  "spoke",
  "not_interested",
  "interested",
  "scheduled_followup",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** The subset of a `referral_partner_calls` row this module reads.
 *  Callers may pass richer objects; the rule ignores everything else. */
export interface CallLogEntry {
  id: string;
  referral_partner_id: string;
  called_at: string;
  outcome: CallOutcome;
  follow_up_at: string | null;
}

export interface DenormalizedPartnerFields {
  last_called_at: string | null;
  last_call_outcome: CallOutcome | null;
  next_follow_up_at: string | null;
}

export interface RecomputeOptions {
  /** ISO-8601 instant treated as "now" for the future-vs-past split on
   *  `follow_up_at`. The DB-side INSERT path passes the request time; the
   *  unit tests pass a fixture so the rule is timezone-stable. */
  now: string;
}

/**
 * Recompute the three denormalized columns the list page reads from the
 * full call log for one partner.
 *
 *   - `last_called_at` — the maximum `called_at` across the partner's
 *     calls. A more recent entry overwrites an older one; a backdated
 *     entry does not rewind state.
 *   - `last_call_outcome` — the outcome of the call that won
 *     `last_called_at`.
 *   - `next_follow_up_at` — the minimum `follow_up_at` strictly in the
 *     future of `now`. Past follow-ups are ignored; if no future
 *     follow-up exists, this is `null`.
 *
 * With an empty call list all three are `null` — the partner's row
 * returns to "uncontacted" denormalized state.
 */
export function recomputeDenormalizedFields(
  calls: ReadonlyArray<CallLogEntry>,
  options: RecomputeOptions,
): DenormalizedPartnerFields {
  if (calls.length === 0) {
    return {
      last_called_at: null,
      last_call_outcome: null,
      next_follow_up_at: null,
    };
  }

  let mostRecent: CallLogEntry = calls[0];
  for (const c of calls) {
    if (c.called_at > mostRecent.called_at) {
      mostRecent = c;
    }
  }

  const nowMs = Date.parse(options.now);
  let earliestFuture: string | null = null;
  for (const c of calls) {
    if (!c.follow_up_at) continue;
    if (Date.parse(c.follow_up_at) <= nowMs) continue;
    if (earliestFuture === null || c.follow_up_at < earliestFuture) {
      earliestFuture = c.follow_up_at;
    }
  }

  return {
    last_called_at: mostRecent.called_at,
    last_call_outcome: mostRecent.outcome,
    next_follow_up_at: earliestFuture,
  };
}
