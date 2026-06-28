// src/lib/timesheets/capture-marker.ts — the pure mapping from a session's
// capture method to its visible list marker (issue #706, AC4).
//
// A Correction (a lead/admin editing a session's times) or a hand-entered
// session both store capture_method = 'hand'; either way the session must show
// a visible marker wherever sessions are listed, so a reader can tell a typed
// time from a live clock-in. A live-clocked session shows nothing.
//
// "Hand-entered" is the one canonical marker text (CONTEXT.md "Correction"):
// the glossary's _Avoid_ list rules out "edit", "adjustment", and "manual
// entry", so both hand-entry and a later edit read the same way.

import type { CaptureMarker } from "./timesheet-aggregator";

/** The marker text to render for a session, or null when none is shown. */
export function captureLabel(capture: CaptureMarker): "Hand-entered" | null {
  return capture === "hand" ? "Hand-entered" : null;
}
