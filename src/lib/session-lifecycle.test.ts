import { describe, it, expect } from "vitest";
import {
  planClockIn,
  planClockOut,
  validateSpan,
  validateCorrectedSpan,
  type OpenSession,
  type Span,
  type SpanProblem,
} from "./session-lifecycle";

// #701 — Time sessions: a worker is On the clock for at most one Job at a time.
// `planClockIn` is the pure decision that turns "this worker tapped Clock-in on
// Job X" into the lifecycle action the server must perform — open a fresh
// session, leave the current one alone, or auto-close the prior one first.
// No I/O: it reads the worker's current Open session (if any) and the request.

describe("planClockIn", () => {
  it("opens a new session when the worker has nothing open", () => {
    expect(
      planClockIn(null, { jobId: "job-1", at: "2026-06-19T14:00:00Z" }),
    ).toEqual({ type: "open" });
  });

  it("auto-closes the prior session when the worker clocks in to a different Job", () => {
    const open: OpenSession = {
      sessionId: "sess-A",
      jobId: "job-1",
      startedAt: "2026-06-19T12:00:00Z",
    };
    expect(
      planClockIn(open, { jobId: "job-2", at: "2026-06-19T14:00:00Z" }),
    ).toEqual({
      type: "switch",
      close: { sessionId: "sess-A", endedAt: "2026-06-19T14:00:00Z" },
    });
  });

  it("is a no-op when the worker clocks in to the Job they are already On", () => {
    const open: OpenSession = {
      sessionId: "sess-A",
      jobId: "job-1",
      startedAt: "2026-06-19T12:00:00Z",
    };
    expect(
      planClockIn(open, { jobId: "job-1", at: "2026-06-19T14:00:00Z" }),
    ).toEqual({ type: "already-open" });
  });
});

describe("planClockOut", () => {
  it("closes the worker's Open session at the clock-out instant", () => {
    const open: OpenSession = {
      sessionId: "sess-A",
      jobId: "job-1",
      startedAt: "2026-06-19T12:00:00Z",
    };
    expect(planClockOut(open, "2026-06-19T15:30:00Z")).toEqual({
      type: "close",
      sessionId: "sess-A",
      endedAt: "2026-06-19T15:30:00Z",
    });
  });

  it("reports nothing-open when the worker has no Open session", () => {
    expect(planClockOut(null, "2026-06-19T15:30:00Z")).toEqual({
      type: "nothing-open",
    });
  });
});

describe("validateSpan", () => {
  // A corrected (or hand-entered) span is only valid when the clock-out is
  // strictly after the clock-in. One rule rejects both a zero-length span and
  // a negative one.
  const cases: Array<[string, string, string, SpanProblem | null]> = [
    ["end after start", "2026-06-19T12:00:00Z", "2026-06-19T13:00:00Z", null],
    [
      "end equals start (zero-length)",
      "2026-06-19T12:00:00Z",
      "2026-06-19T12:00:00Z",
      "ended-not-after-started",
    ],
    [
      "end before start (negative)",
      "2026-06-19T13:00:00Z",
      "2026-06-19T12:00:00Z",
      "ended-not-after-started",
    ],
  ];

  it.each(cases)("%s → %s", (_label, startedAt, endedAt, expected) => {
    expect(validateSpan(startedAt, endedAt)).toBe(expected);
  });
});

describe("validateCorrectedSpan", () => {
  // When a worker corrects or hand-enters a span, it must not collide with the
  // hours they already have recorded on other sessions. Two spans collide when
  // they share real elapsed time — a candidate that starts before another ends
  // and ends after that other begins.
  const noon: Span = {
    startedAt: "2026-06-19T12:00:00Z",
    endedAt: "2026-06-19T13:00:00Z",
  };

  it("rejects a candidate that overlaps an existing span", () => {
    const candidate: Span = {
      startedAt: "2026-06-19T12:30:00Z",
      endedAt: "2026-06-19T13:30:00Z",
    };
    expect(validateCorrectedSpan(candidate, [noon])).toBe("overlap");
  });

  // Spans that merely sit next to each other — fully before, fully after, or
  // touching exactly at an endpoint (one ends as the next begins) — do not
  // collide and are accepted.
  const clear: Array<[string, Span]> = [
    [
      "fully before",
      { startedAt: "2026-06-19T10:00:00Z", endedAt: "2026-06-19T11:00:00Z" },
    ],
    [
      "fully after",
      { startedAt: "2026-06-19T14:00:00Z", endedAt: "2026-06-19T15:00:00Z" },
    ],
    [
      "touching at the start",
      { startedAt: "2026-06-19T11:00:00Z", endedAt: "2026-06-19T12:00:00Z" },
    ],
    [
      "touching at the end",
      { startedAt: "2026-06-19T13:00:00Z", endedAt: "2026-06-19T14:00:00Z" },
    ],
  ];

  it.each(clear)("accepts a candidate %s an existing span", (_label, candidate) => {
    expect(validateCorrectedSpan(candidate, [noon])).toBe(null);
  });

  it("reports the span itself is invalid before checking overlap", () => {
    const backwards: Span = {
      startedAt: "2026-06-19T13:00:00Z",
      endedAt: "2026-06-19T12:00:00Z",
    };
    expect(validateCorrectedSpan(backwards, [])).toBe("ended-not-after-started");
  });
});
