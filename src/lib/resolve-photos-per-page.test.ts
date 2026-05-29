import { describe, expect, it } from "vitest";

import {
  resolvePhotosPerPage,
  type PhotosPerPage,
} from "./resolve-photos-per-page";

describe("resolvePhotosPerPage", () => {
  it('returns 2 when the stored setting is "2"', () => {
    expect(resolvePhotosPerPage({ report_photos_per_page: "2" })).toBe(2);
  });

  it("passes the valid stored strings through to their numbers", () => {
    const cases: Array<[string, PhotosPerPage]> = [
      ["1", 1],
      ["2", 2],
      ["4", 4],
    ];
    for (const [stored, expected] of cases) {
      expect(resolvePhotosPerPage({ report_photos_per_page: stored })).toBe(
        expected,
      );
    }
  });

  it("falls back to 2 when the key is missing", () => {
    expect(resolvePhotosPerPage({})).toBe(2);
  });

  it("falls back to 2 when the settings object is null or undefined", () => {
    expect(resolvePhotosPerPage(null)).toBe(2);
    expect(resolvePhotosPerPage(undefined)).toBe(2);
  });

  it("falls back to 2 for an empty string", () => {
    expect(resolvePhotosPerPage({ report_photos_per_page: "" })).toBe(2);
  });

  it("falls back to 2 for out-of-range or non-numeric strings", () => {
    for (const invalid of ["3", "0", "abc", "-1", "2.5"]) {
      expect(resolvePhotosPerPage({ report_photos_per_page: invalid })).toBe(2);
    }
  });

  it("tolerates a numeric value as well as a string", () => {
    expect(resolvePhotosPerPage({ report_photos_per_page: 1 })).toBe(1);
    expect(resolvePhotosPerPage({ report_photos_per_page: 4 })).toBe(4);
    expect(resolvePhotosPerPage({ report_photos_per_page: 3 })).toBe(2);
  });
});
