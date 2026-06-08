import { describe, it, expect } from "vitest";
import {
  visibleZoomFactors,
  selectFactor,
  revertFactor,
  formatFactorLabel,
} from "./lens-zoom";

describe("visibleZoomFactors", () => {
  it("hides the pill (returns []) when no factors are available", () => {
    expect(visibleZoomFactors([], "rear")).toEqual([]);
  });

  it("hides the pill when only one factor is available", () => {
    expect(visibleZoomFactors([1], "rear")).toEqual([]);
  });

  it("returns [1, 2] on a device without ultra-wide (rear)", () => {
    expect(visibleZoomFactors([1, 2], "rear")).toEqual([1, 2]);
  });

  it("returns all three stops on an ultra-wide device (rear)", () => {
    expect(visibleZoomFactors([0.5, 1, 2], "rear")).toEqual([0.5, 1, 2]);
  });

  it("hides the pill on the front camera regardless of availability", () => {
    expect(visibleZoomFactors([0.5, 1, 2], "front")).toEqual([]);
  });
});

describe("selectFactor", () => {
  it("updates only selectedFactor, leaving confirmedFactor unchanged", () => {
    expect(selectFactor({ selectedFactor: 1, confirmedFactor: 1 }, 2)).toEqual({
      selectedFactor: 2,
      confirmedFactor: 1,
    });
  });
});

describe("revertFactor", () => {
  it("restores selectedFactor to confirmedFactor", () => {
    expect(revertFactor({ selectedFactor: 0.5, confirmedFactor: 1 })).toEqual({
      selectedFactor: 1,
      confirmedFactor: 1,
    });
  });
});

describe("formatFactorLabel", () => {
  it("renders the factor with a multiplication sign", () => {
    expect(formatFactorLabel(0.5)).toBe("0.5×");
    expect(formatFactorLabel(1)).toBe("1×");
    expect(formatFactorLabel(2)).toBe("2×");
  });
});
