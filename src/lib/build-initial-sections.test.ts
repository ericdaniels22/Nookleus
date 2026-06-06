// Issue #405 — Photo Report Rework: Photo Report templates upgraded + moved to
// Settings.
//
// `buildInitialSections` is the single place that decides whether a new report
// starts from a Photo Report template or from a blank slate. Keeping that
// decision in a pure helper (out of component state) makes it unit-testable and
// keeps the create flow from re-deriving "template vs blank" in scattered
// places. A template's Sections carry a heading AND boilerplate write-up text
// (rich-text HTML); both are copied verbatim into the new report's Sections.

import { describe, expect, it } from "vitest";
import {
  buildInitialSections,
  ensureSectionIds,
} from "./build-initial-sections";
import type { PhotoReportTemplate } from "@/lib/types";

function makeTemplate(
  sections: unknown[],
  overrides: Partial<PhotoReportTemplate> = {},
): PhotoReportTemplate {
  return {
    id: "template-1",
    organization_id: "org-1",
    name: "Findings",
    sections,
    created_by: "tester",
    created_at: "2026-06-04T00:00:00Z",
    updated_at: "2026-06-04T00:00:00Z",
    ...overrides,
  };
}

describe("buildInitialSections", () => {
  it("returns an empty array when no template is given", () => {
    expect(buildInitialSections()).toEqual([]);
  });

  it("copies each template Section's heading and boilerplate write-up with empty photo_ids", () => {
    const template = makeTemplate([
      { title: "Exterior", description: "Roof and siding" },
      { title: "Interior", description: "Water damage" },
    ]);

    expect(buildInitialSections(template)).toEqual([
      expect.objectContaining({
        title: "Exterior",
        description: "Roof and siding",
        photo_ids: [],
      }),
      expect.objectContaining({
        title: "Interior",
        description: "Water damage",
        photo_ids: [],
      }),
    ]);
  });

  it("copies a Section's rich-text HTML boilerplate verbatim", () => {
    const template = makeTemplate([
      {
        title: "Findings",
        description:
          "<p>Our inspection found the following:</p><ul><li>Damaged drywall</li></ul>",
      },
    ]);

    expect(buildInitialSections(template)).toEqual([
      expect.objectContaining({
        title: "Findings",
        description:
          "<p>Our inspection found the following:</p><ul><li>Damaged drywall</li></ul>",
        photo_ids: [],
      }),
    ]);
  });

  it("fills in an empty write-up when a template Section omits one", () => {
    const template = makeTemplate([{ title: "Overview" }]);

    expect(buildInitialSections(template)).toEqual([
      expect.objectContaining({ title: "Overview", description: "", photo_ids: [] }),
    ]);
  });

  it("returns an empty array for a template that has no Sections", () => {
    expect(buildInitialSections(makeTemplate([]))).toEqual([]);
  });

  it("stamps each Section with an id from the injected id factory", () => {
    const template = makeTemplate([
      { title: "Exterior", description: "Roof" },
      { title: "Interior", description: "Walls" },
    ]);
    let n = 0;
    const sections = buildInitialSections(template, () => `sec-${++n}`);
    expect(sections.map((s) => s.id)).toEqual(["sec-1", "sec-2"]);
  });

  it("assigns a distinct, non-empty id to each Section by default", () => {
    const template = makeTemplate([
      { title: "A", description: "" },
      { title: "B", description: "" },
    ]);
    const ids = buildInitialSections(template).map((s) => s.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ensureSectionIds", () => {
  it("keeps a Section's existing id and backfills one onto a Section that lacks it", () => {
    const out = ensureSectionIds(
      [
        { id: "keep", title: "A", description: "", photo_ids: ["p1"] },
        { title: "B", description: "", photo_ids: [] },
      ],
      () => "new-1",
    );
    expect(out).toEqual([
      { id: "keep", title: "A", description: "", photo_ids: ["p1"] },
      { id: "new-1", title: "B", description: "", photo_ids: [] },
    ]);
  });

  it("backfills a distinct, non-empty id by default for legacy sections", () => {
    const out = ensureSectionIds([
      { title: "A", description: "", photo_ids: [] },
      { title: "B", description: "", photo_ids: [] },
    ]);
    const ids = out.map((s) => s.id);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
