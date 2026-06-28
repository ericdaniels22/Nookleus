// src/lib/timesheets/zoned-wall-clock.test.ts — the inverse of org-zone's
// `zonedParts` (#706, ADR 0020).
//
// A Correction form lets a lead TYPE a real clock-in/out as a civil wall-clock
// (an HTML datetime-local value: "YYYY-MM-DDTHH:mm", no zone). ADR 0020 requires
// that time be anchored in the ORGANIZATION's single authoritative timezone —
// never the recording device's clock — before it becomes the UTC instant we
// store and later classify. `instantFromZonedWallClock` is that anchor.

import { describe, it, expect } from "vitest";
import { instantFromZonedWallClock } from "./zoned-wall-clock";

describe("instantFromZonedWallClock", () => {
  it("anchors a summer wall-clock in the Org zone (Central, CDT = UTC-5)", () => {
    // 5:00 PM Central on Jul 1 is during DST (CDT, UTC-5) → 22:00 UTC.
    expect(instantFromZonedWallClock("2026-07-01T17:00", "America/Chicago")).toBe(
      "2026-07-01T22:00:00.000Z",
    );
  });

  it("uses the zone's WINTER offset for a winter wall-clock (CST = UTC-6)", () => {
    // Same zone, but Jan 15 is standard time (CST, UTC-6) → 23:00 UTC. Proves
    // the offset is resolved at the typed instant, not hard-coded.
    expect(instantFromZonedWallClock("2026-01-15T17:00", "America/Chicago")).toBe(
      "2026-01-15T23:00:00.000Z",
    );
  });

  it("is the identity (bar the Z) for a UTC Org — the documented fallback zone", () => {
    expect(instantFromZonedWallClock("2026-06-27T17:00", "UTC")).toBe(
      "2026-06-27T17:00:00.000Z",
    );
  });

  it("accepts an optional seconds field", () => {
    expect(
      instantFromZonedWallClock("2026-07-01T17:00:30", "America/Chicago"),
    ).toBe("2026-07-01T22:00:30.000Z");
  });

  it("rejects a string that isn't a civil wall-clock", () => {
    expect(() => instantFromZonedWallClock("not-a-time", "UTC")).toThrow();
    // An already-zoned instant is NOT a civil wall-clock — reject it rather than
    // silently mis-anchoring the trailing Z.
    expect(() =>
      instantFromZonedWallClock("2026-07-01T22:00:00.000Z", "UTC"),
    ).toThrow();
  });
});
