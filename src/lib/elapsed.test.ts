import { describe, it, expect } from "vitest";
import { formatElapsed } from "./elapsed";

// issue #701 — the app-wide status bar shows live-updating elapsed time as a
// compact "2h 14m". The component computes elapsed milliseconds; this pure
// function renders it. Minute granularity (seconds are floored away).
describe("formatElapsed (#701)", () => {
  it("renders just-clocked-in as 0m", () => {
    expect(formatElapsed(0)).toBe("0m");
  });

  it("floors sub-minute time to 0m", () => {
    expect(formatElapsed(59 * 1000)).toBe("0m");
  });

  it("renders whole minutes under an hour", () => {
    expect(formatElapsed(14 * 60 * 1000)).toBe("14m");
  });

  it("renders hours and minutes as '2h 14m'", () => {
    expect(formatElapsed((2 * 60 + 14) * 60 * 1000)).toBe("2h 14m");
  });

  it("keeps the minutes segment on an exact hour ('2h 0m')", () => {
    expect(formatElapsed(2 * 60 * 60 * 1000)).toBe("2h 0m");
  });

  it("clamps negative elapsed (clock skew) to 0m", () => {
    expect(formatElapsed(-5 * 60 * 1000)).toBe("0m");
  });
});
