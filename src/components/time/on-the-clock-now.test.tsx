// on-the-clock-now — the owner-dashboard org-wide Presence panel (#705, epic
// #699). It answers "who is On the clock right now, anywhere in the Org?" —
// each person with the Job they're on and a LIVE elapsed timer counting up from
// clock-in.
//
// The presentational core, OnTheClockNowView, is pure: it renders the roster
// from a sessions list plus an injected `nowMs`, so the elapsed timer is a pure
// function of (startedAt, now) and is testable without fake timers. The live
// ticking and the realtime/permission wiring live in the container below and
// are exercised separately. ADR 0019: identity + Job + time only, no location.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OnTheClockNowView } from "./on-the-clock-now";
import type { OpenSessionPresence } from "@/lib/timesheets/load-open-sessions";

afterEach(cleanup);

function session(over: Partial<OpenSessionPresence> = {}): OpenSessionPresence {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    jobId: "job-1",
    startedAt: "2026-06-27T14:00:00.000Z",
    workerName: "Jordan Rivera",
    job: { jobNumber: "J-100", propertyAddress: "12 Oak St" },
    ...over,
  };
}

// 2026-06-27T16:14:00Z — 2h 14m after the default session's 14:00 clock-in.
const NOW_2H_14M = Date.parse("2026-06-27T16:14:00.000Z");

describe("OnTheClockNowView (#705)", () => {
  it("lists each worker on the clock with their Job and a live elapsed timer", () => {
    render(
      <OnTheClockNowView sessions={[session()]} nowMs={NOW_2H_14M} />,
    );

    expect(screen.getByText("Jordan Rivera")).toBeTruthy();
    // The Job they're on (address preferred over the bare number).
    expect(screen.getByText(/12 Oak St/)).toBeTruthy();
    // Elapsed counts up from clock-in — formatElapsed(2h14m).
    expect(screen.getByText("2h 14m")).toBeTruthy();
  });

  it("titles the panel and shows an empty state when no one is on the clock", () => {
    render(<OnTheClockNowView sessions={[]} nowMs={NOW_2H_14M} />);

    // The panel always announces itself — it's a dashboard section, not a badge.
    expect(screen.getByText(/on the clock now/i)).toBeTruthy();
    expect(screen.getByText(/no one'?s on the clock/i)).toBeTruthy();
  });
});
