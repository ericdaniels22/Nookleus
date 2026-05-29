// Issue #362 — Photo Report Rework, Slice 2.
//
// A photo report is built from an ordered list of sections. Those sections can
// either be seeded from a "section preset" (a `photo_report_templates` row) or
// added by hand. `buildInitialSections` is the single, pure place that turns an
// optional preset into the report's starting sections — so the "start from
// preset vs start blank" decision lives in one unit-testable spot instead of
// being re-derived inside component state.

import type { PhotoReportTemplate } from "@/lib/types";

export interface ReportSection {
  title: string;
  description: string;
  photo_ids: string[];
}

export function buildInitialSections(
  preset?: PhotoReportTemplate | null,
): ReportSection[] {
  if (!preset) return [];
  const presetSections = (preset.sections ?? []) as {
    title?: string;
    description?: string;
  }[];
  return presetSections.map((section) => ({
    title: section.title ?? "",
    description: section.description ?? "",
    photo_ids: [],
  }));
}
