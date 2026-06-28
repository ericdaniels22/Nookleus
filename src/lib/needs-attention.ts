// src/lib/needs-attention.ts — the pure "needs attention" derivation for a
// lead's Timesheet surface (issue #706).
//
// An Open Time session (no clock-out yet) whose elapsed time exceeds the
// threshold is surfaced amber as work for the lead — the classic "someone
// forgot to clock out". This is PURELY derived from elapsed time: it mutates
// nothing and never closes the session. A closed session never qualifies,
// however long it ran (its hours are already recorded).
//
// Timestamps are ISO-8601 UTC instants (ADR 0020). `now` is passed in — this
// module reads no ambient clock, so it stays deterministically testable.

import type { Instant } from "./session-lifecycle";

/** ~12 hours. An Open session must EXCEED this (strictly) to need attention. */
export const NEEDS_ATTENTION_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export interface SessionElapsed {
  startedAt: Instant;
  /** null → still Open (the worker is clocked in). */
  endedAt: Instant | null;
}

/**
 * Whether a session needs the lead's attention: it is still Open AND has been
 * Open longer than the threshold. A closed session is never flagged.
 */
export function needsAttention(session: SessionElapsed, now: Instant): boolean {
  if (session.endedAt !== null) return false;
  return Date.parse(now) - Date.parse(session.startedAt) > NEEDS_ATTENTION_THRESHOLD_MS;
}

/** The subset of `sessions` that need attention, preserving input order. */
export function selectNeedsAttention<T extends SessionElapsed>(
  sessions: T[],
  now: Instant,
): T[] {
  return sessions.filter((session) => needsAttention(session, now));
}
