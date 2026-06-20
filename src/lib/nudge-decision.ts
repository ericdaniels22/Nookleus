// src/lib/nudge-decision.ts — the pure rule for Timesheets self-nudges (#702).
//
// `decideNudge` turns "here is my Open session and how long the app has been
// away" into which local reminder (if any) to surface. No I/O: the caller
// supplies the current instant, the away signal, and the thresholds. It NEVER
// writes a time or clocks anyone out (ADR 0019) — it only returns a label.
//
// No location (ADR 0019): the away signal is a plain instant (device idle /
// app-backgrounded), NOT a geofence. NudgeInputs carries no lat/long/region/
// coordinate field, by design — there is nowhere here to put one.
//
// Instants are epoch-milliseconds so the rule is pure arithmetic; the caller
// converts from the ISO-8601 UTC instants used elsewhere (ADR 0020).

export type NudgeDecision = "none" | "still-clocked-in" | "likely-left";

export interface NudgeInputs {
  // The worker's current Open session start, or null when they are not On the
  // clock — no Open session means there is never anything to nudge about.
  openSessionStartedAtMs: number | null;
  nowMs: number;
  // Device idle / app-backgrounded instant, or null when no away signal is
  // known. Deliberately NON-LOCATION (ADR 0019).
  lastAwaySignalMs: number | null;
  thresholds: { longOpenMs: number; longAwayMs: number };
}

export function decideNudge(inputs: NudgeInputs): NudgeDecision {
  const { openSessionStartedAtMs, nowMs, lastAwaySignalMs, thresholds } = inputs;
  // No Open session → nothing to nudge about.
  if (openSessionStartedAtMs === null) return "none";
  // A stale away signal on an Open session is the stronger concern (they may
  // have left the site), so it wins over a merely long-running session. An away
  // signal from BEFORE this session started is ignored — being away before
  // clocking in says nothing about leaving the current session.
  if (
    lastAwaySignalMs !== null &&
    lastAwaySignalMs >= openSessionStartedAtMs &&
    nowMs - lastAwaySignalMs >= thresholds.longAwayMs
  ) {
    return "likely-left";
  }
  if (nowMs - openSessionStartedAtMs >= thresholds.longOpenMs) {
    return "still-clocked-in";
  }
  return "none";
}
