// src/lib/session-lifecycle.ts — the pure rules for a worker's Time sessions.
//
// A worker is On the clock for at most one Job at a time (the partial unique
// index on time_sessions pins this at the database; these functions keep the
// app from ever asking the database to break it). No I/O — callers pass the
// worker's current Open session and the request; the functions return the
// lifecycle action to perform.
//
// Timestamps are ISO-8601 UTC instants (ADR 0020 — hours are recorded in UTC).

export type Instant = string;

export interface OpenSession {
  sessionId: string;
  jobId: string;
  startedAt: Instant;
}

export interface ClockInRequest {
  jobId: string;
  at: Instant;
}

export type ClockInPlan =
  | { type: "open" }
  | { type: "already-open" }
  | { type: "switch"; close: { sessionId: string; endedAt: Instant } };

export type ClockOutPlan =
  | { type: "close"; sessionId: string; endedAt: Instant }
  | { type: "nothing-open" };

export interface Span {
  startedAt: Instant;
  endedAt: Instant;
}

export type SpanProblem = "ended-not-after-started" | "overlap";

export function planClockIn(
  open: OpenSession | null,
  req: ClockInRequest,
): ClockInPlan {
  if (open === null) return { type: "open" };
  if (open.jobId === req.jobId) return { type: "already-open" };
  return {
    type: "switch",
    close: { sessionId: open.sessionId, endedAt: req.at },
  };
}

export function planClockOut(
  open: OpenSession | null,
  at: Instant,
): ClockOutPlan {
  if (open === null) return { type: "nothing-open" };
  return { type: "close", sessionId: open.sessionId, endedAt: at };
}

export function validateSpan(
  startedAt: Instant,
  endedAt: Instant,
): SpanProblem | null {
  if (Date.parse(endedAt) <= Date.parse(startedAt)) {
    return "ended-not-after-started";
  }
  return null;
}

export function validateCorrectedSpan(
  candidate: Span,
  others: Span[],
): SpanProblem | null {
  const itself = validateSpan(candidate.startedAt, candidate.endedAt);
  if (itself !== null) return itself;
  const start = Date.parse(candidate.startedAt);
  const end = Date.parse(candidate.endedAt);
  for (const other of others) {
    // Two spans share real time when each starts strictly before the other
    // ends. Touching exactly at an endpoint is not an overlap.
    if (start < Date.parse(other.endedAt) && Date.parse(other.startedAt) < end) {
      return "overlap";
    }
  }
  return null;
}
