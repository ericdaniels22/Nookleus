// Issue #405 — Photo Report Rework: Photo Report templates upgraded + moved to
// Settings.
//
// A Photo Report is built from an ordered list of Sections. Those Sections can
// either be seeded from a Photo Report template (a `photo_report_templates`
// row) or added by hand. `buildInitialSections` is the single, pure place that
// turns an optional template into the report's starting Sections — so the
// "start from a template vs start blank" decision lives in one unit-testable
// spot instead of being re-derived inside component state.
//
// A template's Sections carry a heading (`title`) AND boilerplate write-up text
// (`description`, the same one-page rich-text HTML a report Section holds — see
// CONTEXT.md and ADR 0009). Both are copied verbatim; the new Sections start
// with no photos. Reconciling the user's selected photos with these Sections is
// the create step's job (see `createPhotoReportDraft`), keeping this helper pure.

import type { PhotoReportTemplate } from "@/lib/types";

export interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

export function buildInitialSections(
  template?: PhotoReportTemplate | null,
): ReportSection[] {
  if (!template) return [];
  const templateSections = (template.sections ?? []) as {
    title?: string;
    description?: string;
  }[];
  return templateSections.map((section) => ({
    title: section.title ?? "",
    description: section.description ?? "",
    photo_ids: [],
  }));
}
