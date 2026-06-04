import { describe, it, expect } from "vitest";
import { photoLoadPriority } from "./photo-load-priority";

describe("photoLoadPriority — first row loads eagerly at high priority", () => {
  it("loads the first image (index 0) eagerly at high priority", () => {
    expect(photoLoadPriority(0, 8)).toEqual({
      loading: "eager",
      fetchPriority: "high",
    });
  });

  it("loads the last image of the first row (index = columns - 1) eagerly", () => {
    expect(photoLoadPriority(7, 8)).toEqual({
      loading: "eager",
      fetchPriority: "high",
    });
  });
});

describe("photoLoadPriority — second row and below stay lazy", () => {
  it("loads the first image of the second row (index = columns) lazily", () => {
    expect(photoLoadPriority(8, 8)).toEqual({
      loading: "lazy",
      fetchPriority: "auto",
    });
  });

  it("loads a deep image far below the first row lazily", () => {
    expect(photoLoadPriority(50, 8)).toEqual({
      loading: "lazy",
      fetchPriority: "auto",
    });
  });
});

describe("photoLoadPriority — date groups below the top of the grid", () => {
  // Only the newest date group shows a visible top row, so every other group
  // is rendered with columnsPerRow = 0 — meaning none of its images are eager.
  it("loads every image lazily when there is no first row (columns = 0)", () => {
    expect(photoLoadPriority(0, 0)).toEqual({
      loading: "lazy",
      fetchPriority: "auto",
    });
  });
});
