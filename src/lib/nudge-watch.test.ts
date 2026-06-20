import { describe, it, expect } from "vitest";
import { initialNudgeSurfaceState } from "./nudge-surface";
import { evaluateNudgeTick } from "./nudge-watch";

// #702 — the pure "nudge engine": one call per timer tick / foreground that the
// (untested) AwayWatcher glue makes. It composes decideNudge (which reminder, if
// any, the inputs warrant) with reduceNudgeSurface (fire each at most once per
// Open session), so the glue only has to record signals and render a toast.
//
// It is I/O-free and reminder-only: the caller supplies the Open session, the
// current instant, the last NON-LOCATION away signal (ADR 0019 / AC6) and the
// thresholds; it returns the advanced state plus a reminder *descriptor* — never
// a clock-out or a time write (AC8). Instants are epoch-ms (ADR 0020).

const THRESHOLDS = { longOpenMs: 8 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 };
const START = 0;

describe("evaluateNudgeTick", () => {
  it("surfaces a 'still clocked in' reminder once a session has been Open past the long-open threshold", () => {
    const { state, reminder } = evaluateNudgeTick(initialNudgeSurfaceState, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longOpenMs,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });

    expect(reminder).toEqual({
      decision: "still-clocked-in",
      openSessionId: "sess-1",
    });
    expect(state.surfaced).toContain("still-clocked-in");
  });

  it("surfaces a 'likely left' reminder when the away signal on an Open session has gone stale past the long-away threshold", () => {
    const { reminder } = evaluateNudgeTick(initialNudgeSurfaceState, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longAwayMs,
      // Backgrounded right at the start, still away a full threshold later — and
      // this signal is a plain instant, never a location (ADR 0019 / AC6).
      lastAwaySignalMs: START,
      thresholds: THRESHOLDS,
    });

    expect(reminder).toEqual({
      decision: "likely-left",
      openSessionId: "sess-1",
    });
  });

  it("surfaces nothing for a normal Open session — under the long-open threshold with no stale away signal", () => {
    const { state, reminder } = evaluateNudgeTick(initialNudgeSurfaceState, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longOpenMs - 1,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });

    expect(reminder).toBeNull();
    expect(state.surfaced).toEqual([]);
  });

  it("fires a reminder only once across repeated ticks of the same Open session (AC8: a per-minute tick does not re-toast)", () => {
    const first = evaluateNudgeTick(initialNudgeSurfaceState, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longOpenMs,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });
    expect(first.reminder).not.toBeNull();

    // A minute later the session is still Open and still long — but having
    // already nudged, the engine stays quiet (no re-toast, no time write).
    const second = evaluateNudgeTick(first.state, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longOpenMs + 60_000,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });

    expect(second.reminder).toBeNull();
  });

  it("nudges again for a new Open session even though the same reminder already fired for the previous one", () => {
    const first = evaluateNudgeTick(initialNudgeSurfaceState, {
      openSessionId: "sess-1",
      openSessionStartedAtMs: START,
      nowMs: START + THRESHOLDS.longOpenMs,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });

    // A brand-new long-open session (a different clock-in) starts later.
    const laterStart = START + 10 * 60 * 60 * 1000;
    const next = evaluateNudgeTick(first.state, {
      openSessionId: "sess-2",
      openSessionStartedAtMs: laterStart,
      nowMs: laterStart + THRESHOLDS.longOpenMs,
      lastAwaySignalMs: null,
      thresholds: THRESHOLDS,
    });

    expect(next.reminder).toEqual({
      decision: "still-clocked-in",
      openSessionId: "sess-2",
    });
  });
});
