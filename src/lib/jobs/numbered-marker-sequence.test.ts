import { describe, it, expect } from "vitest";

import {
  nextMarkerNumber,
  renumberAfterDelete,
} from "./numbered-marker-sequence";

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

describe("renumberAfterDelete — keeping the Numbered sequence contiguous", () => {
  describe("a marker deleted from the middle", () => {
    it("closes the gap so the survivors read 1, 2, 3", () => {
      // Markers 1, 2, 3, 4 dropped, then #2 deleted. The survivors keep their
      // relative order but renumber so the visible sequence has no gap.
      const markers = [
        { id: "a", number: 1 },
        { id: "b", number: 2 },
        { id: "c", number: 3 },
        { id: "d", number: 4 },
      ];

      const next = renumberAfterDelete(markers, "b");

      expect(next).toEqual([
        { id: "a", number: 1 },
        { id: "c", number: 2 },
        { id: "d", number: 3 },
      ]);
    });
  });

  describe("the last marker deleted", () => {
    it("leaves the others untouched — nothing renumbers", () => {
      // Deleting the highest number leaves no gap, so 1, 2 stay 1, 2.
      const markers = [
        { id: "a", number: 1 },
        { id: "b", number: 2 },
        { id: "c", number: 3 },
      ];

      const next = renumberAfterDelete(markers, "c");

      expect(next).toEqual([
        { id: "a", number: 1 },
        { id: "b", number: 2 },
      ]);
    });
  });

  describe("the first marker deleted", () => {
    it("shifts the rest down so 2, 3 become 1, 2", () => {
      // Deleting #1 leaves a gap at the front; every survivor steps down one.
      const markers = [
        { id: "a", number: 1 },
        { id: "b", number: 2 },
        { id: "c", number: 3 },
      ];

      const next = renumberAfterDelete(markers, "a");

      expect(next).toEqual([
        { id: "b", number: 1 },
        { id: "c", number: 2 },
      ]);
    });
  });

  describe("the only marker deleted", () => {
    it("yields an empty sequence", () => {
      // Deleting the sole marker leaves the Photo with no Numbered markers.
      const markers = [{ id: "a", number: 1 }];

      const next = renumberAfterDelete(markers, "a");

      expect(next).toEqual([]);
    });
  });
});
