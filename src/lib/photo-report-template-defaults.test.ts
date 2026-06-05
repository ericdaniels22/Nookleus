// Issue #405 — Photo Report Rework: the default Photo Report templates an
// Organization seeds from Settings. Each template carries a heading plus
// boilerplate write-up (rich-text HTML) per Section; the boilerplate seeds a
// new report you then edit. Placeholder copy is fine — the owner edits the real
// wording in Settings.

import { describe, expect, it } from "vitest";
import { DEFAULT_PHOTO_REPORT_TEMPLATES } from "./photo-report-template-defaults";

describe("DEFAULT_PHOTO_REPORT_TEMPLATES", () => {
  it("ships Findings and Work Performed templates", () => {
    const names = DEFAULT_PHOTO_REPORT_TEMPLATES.map((t) => t.name);
    expect(names).toContain("Findings");
    expect(names).toContain("Work Performed");
  });

  it("gives every default template at least one Section with a heading", () => {
    expect(DEFAULT_PHOTO_REPORT_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of DEFAULT_PHOTO_REPORT_TEMPLATES) {
      expect(template.sections.length).toBeGreaterThan(0);
      for (const section of template.sections) {
        expect(section.title.trim()).not.toBe("");
      }
    }
  });

  it("gives every Section non-empty rich-text boilerplate write-up", () => {
    for (const template of DEFAULT_PHOTO_REPORT_TEMPLATES) {
      for (const section of template.sections) {
        expect(section.description.trim()).not.toBe("");
        // Boilerplate is the same rich-text HTML a report Section write-up holds,
        // so it flows straight through buildInitialSections into a new report.
        expect(section.description).toMatch(/<[a-z][^>]*>/i);
      }
    }
  });
});
