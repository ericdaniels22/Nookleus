import { describe, it, expect } from "vitest";
import { resistedReveal } from "./pull-resistance";

describe("resistedReveal — rubber-band pull resistance (#677)", () => {
  const MAX = 56;

  it("reveals nothing at rest", () => {
    expect(resistedReveal(0, MAX)).toBe(0);
  });

  it("follows the finger nearly 1:1 for a small initial pull, but always a touch less", () => {
    // The first few px of pull move the row almost the same distance — the
    // drag reads as attached to the finger before resistance takes over —
    // yet resistance is already shaving it below 1:1, so it never tracks
    // *exactly* (a hard-clamped linear track would read 1:1 then hit a wall).
    const r = resistedReveal(4, MAX);
    expect(r).toBeGreaterThan(3);
    expect(r).toBeLessThan(4);
  });

  it("stiffens the further you drag — each equal pull reveals less, well before the cap", () => {
    // Sample three depths all far below the cap so this measures the curve's
    // sub-linear slope decay, not the saturation wall: a linear track (even one
    // that later clamps at the cap) reveals equal amounts for equal pulls here,
    // so a decreasing step size pins the genuine rubber-band curvature.
    const firstStep = resistedReveal(10, MAX) - resistedReveal(0, MAX);
    const secondStep = resistedReveal(20, MAX) - resistedReveal(10, MAX);
    const thirdStep = resistedReveal(30, MAX) - resistedReveal(20, MAX);
    expect(secondStep).toBeLessThan(firstStep);
    expect(thirdStep).toBeLessThan(secondStep);
  });

  it("is monotonic — more pull never reveals less", () => {
    let prev = -1;
    for (let pull = 0; pull <= 400; pull += 20) {
      const r = resistedReveal(pull, MAX);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("never exceeds the cap no matter how hard you pull", () => {
    expect(resistedReveal(100_000, MAX)).toBeLessThan(MAX);
    expect(resistedReveal(100_000, MAX)).toBeGreaterThan(MAX * 0.99);
  });

  it("treats an upward (negative) pull as no reveal", () => {
    expect(resistedReveal(-50, MAX)).toBe(0);
  });
});
