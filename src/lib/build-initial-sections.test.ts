// Issue #362 — Photo Report Rework, Slice 2.
//
// `buildInitialSections` is the single place that decides whether a new report
// starts from a section preset or from a blank slate. Keeping that decision in
// a pure helper (out of component state) makes it unit-testable and keeps the
// wizard from re-deriving "preset vs blank" in scattered places.

import { describe, expect, it } from "vitest";
import { buildInitialSections } from "./build-initial-sections";
import type { PhotoReportTemplate } from "@/lib/types";

function makePreset(
  sections: unknown[],
  overrides: Partial<PhotoReportTemplate> = {},
): PhotoReportTemplate {
  return {
    id: "preset-1",
    organization_id: "org-1",
    name: "Insurance Adjuster Report",
    audience: "adjuster",
    sections,
    cover_page: {},
    photos_per_page: 4,
    created_by: "tester",
    created_at: "2026-05-29T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

describe("buildInitialSections", () => {
  it("returns an empty array when no preset is given", () => {
    expect(buildInitialSections()).toEqual([]);
  });

  it("maps a preset's sections to title/description with empty photo_ids", () => {
    const preset = makePreset([
      { title: "Exterior", description: "Roof and siding" },
      { title: "Interior", description: "Water damage" },
    ]);

    expect(buildInitialSections(preset)).toEqual([
      { title: "Exterior", description: "Roof and siding", photo_ids: [] },
      { title: "Interior", description: "Water damage", photo_ids: [] },
    ]);
  });

  it("fills in an empty description when a preset section omits one", () => {
    const preset = makePreset([{ title: "Overview" }]);

    expect(buildInitialSections(preset)).toEqual([
      { title: "Overview", description: "", photo_ids: [] },
    ]);
  });

  it("returns an empty array for a preset that has no sections", () => {
    expect(buildInitialSections(makePreset([]))).toEqual([]);
  });
});
