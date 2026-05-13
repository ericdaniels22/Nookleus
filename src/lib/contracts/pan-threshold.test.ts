import { describe, expect, it } from "vitest";
import { PAN_THRESHOLD_PX, isPanThresholdExceeded } from "./pan-threshold";

describe("isPanThresholdExceeded", () => {
  it("returns false when cursor hasn't moved", () => {
    expect(isPanThresholdExceeded(0, 0)).toBe(false);
  });

  it("returns false for sub-threshold movement", () => {
    expect(isPanThresholdExceeded(2, 2)).toBe(false); // hypot ≈ 2.83
  });

  it("returns true at exactly the threshold", () => {
    expect(isPanThresholdExceeded(PAN_THRESHOLD_PX, 0)).toBe(true);
    expect(isPanThresholdExceeded(0, PAN_THRESHOLD_PX)).toBe(true);
  });

  it("returns true past the threshold along the diagonal", () => {
    expect(isPanThresholdExceeded(3, 3)).toBe(true); // hypot ≈ 4.24
  });

  it("treats negative deltas the same as positive (direction-agnostic)", () => {
    expect(isPanThresholdExceeded(-5, 0)).toBe(true);
    expect(isPanThresholdExceeded(0, -5)).toBe(true);
    expect(isPanThresholdExceeded(-3, -3)).toBe(true);
  });

  it("honors a custom threshold override", () => {
    expect(isPanThresholdExceeded(5, 0, 10)).toBe(false);
    expect(isPanThresholdExceeded(10, 0, 10)).toBe(true);
  });
});
