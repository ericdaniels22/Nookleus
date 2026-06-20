import { describe, it, expect } from "vitest";
import {
  initialNudgeSurfaceState,
  reduceNudgeSurface,
} from "./nudge-surface";

// #702 — the pure throttle that turns a stream of decideNudge() evaluations
// (run on a timer / on foreground) into at-most-once-per-session in-app
// reminders. It is I/O-free: it issues a reminder *descriptor* (a label + the
// Open session to navigate to) and NOTHING that writes a time or clocks anyone
// out. The reminder-only shape is what keeps AC6/AC8 enforceable here rather
// than in the (untested) toast glue. A decision fires once per Open session so
// a per-minute tick does not re-toast, and dismissing/ignoring it never
// re-triggers (AC8); a new session resets the slate.

describe("reduceNudgeSurface", () => {
  it("surfaces a reminder for a fresh 'still clocked in' decision on an Open session", () => {
    const { state, reminder } = reduceNudgeSurface(initialNudgeSurfaceState, {
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });

    expect(reminder).toEqual({
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });
    // The reminder carries no clock-out, no time, no location — only what is
    // needed to take the worker to their Open session.
    expect(Object.keys(reminder ?? {}).sort()).toEqual([
      "decision",
      "openSessionId",
    ]);
    expect(state.surfaced).toContain("still-clocked-in");
  });

  it("surfaces nothing when there is no nudge to fire ('none')", () => {
    const { state, reminder } = reduceNudgeSurface(initialNudgeSurfaceState, {
      decision: "none",
      openSessionId: "sess-1",
    });

    expect(reminder).toBeNull();
    expect(state.surfaced).toEqual([]);
  });

  it("fires a given reminder only once per Open session — a later tick with the same decision surfaces nothing (AC8: dismissing/ignoring never re-triggers)", () => {
    const first = reduceNudgeSurface(initialNudgeSurfaceState, {
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });
    expect(first.reminder).not.toBeNull();

    const second = reduceNudgeSurface(first.state, {
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });

    expect(second.reminder).toBeNull();
    expect(second.state.surfaced).toEqual(["still-clocked-in"]);
  });

  it("fires each reminder independently — a 'likely left' nudge still surfaces after a 'still clocked in' one on the same session", () => {
    const first = reduceNudgeSurface(initialNudgeSurfaceState, {
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });

    const second = reduceNudgeSurface(first.state, {
      decision: "likely-left",
      openSessionId: "sess-1",
    });

    expect(second.reminder).toEqual({
      decision: "likely-left",
      openSessionId: "sess-1",
    });
  });

  it("resets per Open session — a reminder already shown for an earlier session fires again for a new session", () => {
    const first = reduceNudgeSurface(initialNudgeSurfaceState, {
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });

    const newSession = reduceNudgeSurface(first.state, {
      decision: "still-clocked-in",
      openSessionId: "sess-2",
    });

    expect(newSession.reminder).toEqual({
      decision: "still-clocked-in",
      openSessionId: "sess-2",
    });
  });
});
