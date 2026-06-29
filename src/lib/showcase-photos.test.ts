import { describe, it, expect } from "vitest";
import { sanitizeShowcasePhotoSelection } from "./showcase-photos";

// #613 — Showcase builder. A Showcase's photos are picked from the Job's own
// Photos, and the pick order is meaningful (it is the gallery order). This pure
// sanitizer is the integrity gate the create/save route runs on whatever
// photo_ids the client submits.
describe("sanitizeShowcasePhotoSelection", () => {
  it("keeps the job's own photos in the requested order and drops foreign ids", () => {
    const jobPhotoIds = ["a", "b", "c"];
    const requested = ["c", "x", "a"]; // "x" does not belong to the Job

    expect(sanitizeShowcasePhotoSelection(jobPhotoIds, requested)).toEqual([
      "c",
      "a",
    ]);
  });

  it("drops duplicate ids, keeping the first time each photo was chosen", () => {
    const jobPhotoIds = ["a", "b", "c"];
    const requested = ["b", "a", "b", "a"]; // each picked twice

    expect(sanitizeShowcasePhotoSelection(jobPhotoIds, requested)).toEqual([
      "b",
      "a",
    ]);
  });
});
