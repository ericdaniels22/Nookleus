// issue #706 (parent epic #699) — the visible hand-entered marker (AC4).
//
// A session whose capture_method is 'hand' (created by hand, or whose times
// were edited by a Correction) must render a visible marker WHEREVER sessions
// are listed. A live-clocked session shows no marker. This is the pure mapping
// from the stored CaptureMarker to that display label; the UI just renders it.
//
// The label text is "Hand-entered" (CONTEXT.md "Correction": the session is
// marked "hand-entered"; the glossary's _Avoid_ list rules out "edit"/"manual
// entry"/"adjustment" — one canonical marker for both hand-entry and edit).

import { describe, it, expect } from "vitest";
import { captureLabel } from "./capture-marker";

describe("captureLabel", () => {
  it("labels a hand-entered/corrected session", () => {
    expect(captureLabel("hand")).toBe("Hand-entered");
  });

  it("shows no marker for a live-clocked session", () => {
    expect(captureLabel("live")).toBeNull();
  });
});
