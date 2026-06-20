// src/lib/nudge-surface.ts — the pure throttle for Timesheets self-nudges
// (#702). It sits on top of decideNudge (nudge-decision.ts): given the latest
// decision plus the current Open session, it decides whether to surface an
// in-app reminder *now*, firing each reminder at most once per Open session so
// a per-minute tick does not re-toast and a dismissed reminder never
// re-triggers (AC8).
//
// It is I/O-free and reminder-only: it returns a descriptor (which reminder +
// the Open session to open), never an action that writes a time or clocks
// anyone out, and it carries no location field (ADR 0019 / AC6). The toast glue
// renders the descriptor; all the decision logic lives here, tested.

import type { NudgeDecision } from "./nudge-decision";

export type ActionableNudge = Exclude<NudgeDecision, "none">;

export interface NudgeReminder {
  decision: ActionableNudge;
  openSessionId: string;
}

export interface NudgeSurfaceState {
  /** The Open session the `surfaced` slate belongs to; a new session resets it. */
  openSessionId: string | null;
  surfaced: ActionableNudge[];
}

export const initialNudgeSurfaceState: NudgeSurfaceState = {
  openSessionId: null,
  surfaced: [],
};

export function reduceNudgeSurface(
  state: NudgeSurfaceState,
  evt: { decision: NudgeDecision; openSessionId: string | null },
): { state: NudgeSurfaceState; reminder: NudgeReminder | null } {
  // Nothing to fire, or no Open session to point at → no reminder, no change.
  if (evt.decision === "none" || evt.openSessionId === null) {
    return { state, reminder: null };
  }
  // A new Open session wipes the slate — a reminder shown for an earlier session
  // is allowed to fire again for this one (each session is throttled on its own).
  const surfaced =
    evt.openSessionId === state.openSessionId ? state.surfaced : [];
  // Already shown for this session → don't re-toast on a later tick (AC8).
  if (surfaced.includes(evt.decision)) {
    return { state, reminder: null };
  }
  return {
    state: {
      openSessionId: evt.openSessionId,
      surfaced: [...surfaced, evt.decision],
    },
    reminder: {
      decision: evt.decision,
      openSessionId: evt.openSessionId,
    },
  };
}
