import { describe, it, expect } from "vitest";
import { decideNudge, type NudgeInputs } from "./nudge-decision";

// #702 — Timesheets self-nudges. `decideNudge` is the pure rule that turns
// "here is my Open session and how long the app has been away" into which local
// reminder (if any) to surface. No I/O: the caller supplies the current instant,
// the away signal, and the thresholds. It NEVER writes a time or clocks anyone
// out (ADR 0019) — it only returns a label.

describe("decideNudge", () => {
  it("fires nothing when the worker has no Open session", () => {
    const inputs: NudgeInputs = {
      openSessionStartedAtMs: null,
      nowMs: Date.parse("2026-06-19T23:00:00Z"),
      lastAwaySignalMs: Date.parse("2026-06-19T12:00:00Z"),
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    expect(decideNudge(inputs)).toBe("none");
  });

  it("fires 'still-clocked-in' when a session has been Open past the long-open threshold", () => {
    const inputs: NudgeInputs = {
      // Clocked in 13h ago, no away signal — they may have simply forgotten.
      openSessionStartedAtMs: Date.parse("2026-06-19T07:00:00Z"),
      nowMs: Date.parse("2026-06-19T20:00:00Z"),
      lastAwaySignalMs: null,
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    expect(decideNudge(inputs)).toBe("still-clocked-in");
  });

  it("fires 'likely-left' when an Open session has a stale away signal", () => {
    const inputs: NudgeInputs = {
      // Clocked in only 2h ago (under long-open), but the app has been away for
      // 45min (over long-away) — they likely left the site still clocked in.
      openSessionStartedAtMs: Date.parse("2026-06-19T18:00:00Z"),
      nowMs: Date.parse("2026-06-19T20:00:00Z"),
      lastAwaySignalMs: Date.parse("2026-06-19T19:15:00Z"),
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    expect(decideNudge(inputs)).toBe("likely-left");
  });

  it("fires nothing for a short Open session whose away signal is still recent", () => {
    const inputs: NudgeInputs = {
      // Clocked in 2h ago and away for only 10min — under both thresholds.
      openSessionStartedAtMs: Date.parse("2026-06-19T18:00:00Z"),
      nowMs: Date.parse("2026-06-19T20:00:00Z"),
      lastAwaySignalMs: Date.parse("2026-06-19T19:50:00Z"),
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    expect(decideNudge(inputs)).toBe("none");
  });

  it("ignores an away signal that predates the Open session — being away before clocking in cannot mean you left the current session", () => {
    const inputs: NudgeInputs = {
      // Clocked in at 19:30; the only away signal is from 18:00 — before this
      // session even started, so it says nothing about leaving it. Under the
      // long-open threshold, the verdict must be 'none', not a false 'likely-left'.
      openSessionStartedAtMs: Date.parse("2026-06-19T19:30:00Z"),
      nowMs: Date.parse("2026-06-19T20:00:00Z"),
      lastAwaySignalMs: Date.parse("2026-06-19T18:00:00Z"),
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    expect(decideNudge(inputs)).toBe("none");
  });

  it("takes no location data — the away signal is non-location (ADR 0019)", () => {
    const inputs: NudgeInputs = {
      openSessionStartedAtMs: Date.parse("2026-06-19T18:00:00Z"),
      nowMs: Date.parse("2026-06-19T20:00:00Z"),
      lastAwaySignalMs: Date.parse("2026-06-19T19:15:00Z"),
      thresholds: { longOpenMs: 12 * 60 * 60 * 1000, longAwayMs: 30 * 60 * 1000 },
    };
    // The 'likely-left' nudge must decide from a non-location away signal only.
    // No key anywhere in the inputs (top-level or nested) may name a location
    // concept — guards against a geofence/coordinate field creeping in later.
    const forbidden = /(latitude|longitude|\blat\b|\blng\b|geo|fence|region|coord|gps|location)/i;
    const keys: string[] = [];
    const collect = (obj: unknown) => {
      if (obj && typeof obj === "object") {
        for (const k of Object.keys(obj)) {
          keys.push(k);
          collect((obj as Record<string, unknown>)[k]);
        }
      }
    };
    collect(inputs);
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
  });
});
