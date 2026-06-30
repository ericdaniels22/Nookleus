import { describe, it, expect } from "vitest";

import { nextMarkerNumber } from "./numbered-marker-sequence";

describe("nextMarkerNumber — the number a freshly-dropped Numbered marker gets", () => {
  describe("a Photo with no Numbered markers", () => {
    it("starts the sequence at 1", () => {
      expect(nextMarkerNumber([])).toBe(1);
    });
  });

  describe("a Photo that already has one marker", () => {
    it("gives the next drop the number 2", () => {
      expect(nextMarkerNumber([1])).toBe(2);
    });
  });

  describe("a Photo with a run of markers", () => {
    it("continues from the highest, so 1, 2, 3 yields 4", () => {
      expect(nextMarkerNumber([1, 2, 3])).toBe(4);
    });
  });

  describe("a Photo where a middle marker was deleted", () => {
    it("takes highest-plus-one regardless of order, so a gap is never re-used", () => {
      // Markers 1, 2, 3 dropped, then 2 deleted: the canvas reports {1, 3}.
      // The next drop is 4 (highest + 1), not 2 (the freed gap) and not 3
      // (count + 1) — placement order stays monotonic and the deleted number
      // is never resequenced. Order of the input must not matter.
      expect(nextMarkerNumber([3, 1])).toBe(4);
    });
  });
});
