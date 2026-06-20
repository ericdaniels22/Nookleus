// src/lib/nudge-watch.ts — the pure "nudge engine" for Timesheets self-nudges
// (#702). It is the single call the (untested) AwayWatcher glue makes per timer
// tick / foreground: it composes decideNudge (nudge-decision.ts: which reminder,
// if any, the inputs warrant) with reduceNudgeSurface (nudge-surface.ts: fire
// each reminder at most once per Open session). Pulling the composition here
// keeps the React glue dumb — it only records the away signal and renders the
// reminder descriptor as a toast.
//
// I/O-free and reminder-only: the caller supplies the Open session, the current
// instant, the last NON-LOCATION away signal (ADR 0019 / AC6) and the
// thresholds; it returns the advanced state plus a reminder descriptor — never a
// clock-out or a time write (AC8). Instants are epoch-ms (ADR 0020).

import { decideNudge } from "./nudge-decision";
import {
  reduceNudgeSurface,
  type NudgeReminder,
  type NudgeSurfaceState,
} from "./nudge-surface";

export interface NudgeTickInputs {
  /** The current Open session to nudge about, or null when off the clock. */
  openSessionId: string | null;
  openSessionStartedAtMs: number | null;
  nowMs: number;
  /** Last device-idle / app-backgrounded instant; NON-LOCATION (ADR 0019). */
  lastAwaySignalMs: number | null;
  thresholds: { longOpenMs: number; longAwayMs: number };
}

export function evaluateNudgeTick(
  state: NudgeSurfaceState,
  inputs: NudgeTickInputs,
): { state: NudgeSurfaceState; reminder: NudgeReminder | null } {
  const decision = decideNudge({
    openSessionStartedAtMs: inputs.openSessionStartedAtMs,
    nowMs: inputs.nowMs,
    lastAwaySignalMs: inputs.lastAwaySignalMs,
    thresholds: inputs.thresholds,
  });
  return reduceNudgeSurface(state, {
    decision,
    openSessionId: inputs.openSessionId,
  });
}
