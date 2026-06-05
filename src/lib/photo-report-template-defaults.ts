// Issue #405 — Photo Report Rework: Photo Report templates upgraded + moved to
// Settings.
//
// The starter Photo Report templates an Organization can seed from Settings →
// Templates → "Photo Report Templates". Each template is a reusable set of
// Sections (a heading plus boilerplate write-up text); starting a report from
// one pre-fills its Sections, which stay fully editable (template_id is
// provenance only — see ADR 0009 / ADR 0003 amendment).
//
// A Section's `description` is the one-page rich-text write-up (the same field a
// report Section holds; see CONTEXT.md and `section-writeup.ts`), so the
// boilerplate below is authored as the HTML subset the TipTap editor produces
// and `html-to-pdf` renders. The copy here is deliberately generic placeholder
// text — the owner edits the real wording in Settings.

/** One Section of a default template: a heading + boilerplate write-up HTML. */
export interface PhotoReportTemplateSeedSection {
  title: string;
  /** Boilerplate write-up as rich-text HTML (paragraphs + bullet lists). */
  description: string;
}

/**
 * A seed for a `photo_report_templates` row. Only `name` + `sections` are seeded
 * — the legacy `audience` / `cover_page` / `photos_per_page` columns are dead in
 * the post-rework model and fall back to their DB defaults (ADR 0009).
 */
export interface PhotoReportTemplateSeed {
  name: string;
  sections: PhotoReportTemplateSeedSection[];
}

export const DEFAULT_PHOTO_REPORT_TEMPLATES: PhotoReportTemplateSeed[] = [
  {
    name: "Findings",
    sections: [
      {
        title: "Findings",
        description:
          "<p>Summarize what the inspection found at the property. Note the affected areas, the type and extent of the damage, and any moisture or safety concerns observed.</p>" +
          "<ul><li>Affected areas and materials</li><li>Type and extent of damage</li><li>Moisture readings or other measurements</li></ul>",
      },
    ],
  },
  {
    name: "Work Performed",
    sections: [
      {
        title: "Work Performed",
        description:
          "<p>Describe the work performed at the property. Outline the scope completed, the equipment placed, and the current status of the job.</p>" +
          "<ul><li>Scope of work completed</li><li>Equipment installed and placement</li><li>Current status and next steps</li></ul>",
      },
    ],
  },
];
