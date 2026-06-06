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
  /**
   * Stable identity for a Section, independent of its position in the report
   * (#467). The builder keys its React list and dnd-kit sortable off this id
   * (not the array index) so editing a Section then reordering it keeps input
   * focus/caret pinned to the same Section and the reorder animates smoothly.
   */
  id: string;
  title: string;
  description: string;
  photo_ids: string[];
}

/**
 * A Section as it may come off disk. Reports created before #467 persisted their
 * Sections without an `id`, so the loaded shape makes `id` optional; the builder
 * backfills any missing id on load via `ensureSectionIds`, keeping old saved
 * reports openable and reorderable without a data migration.
 */
export type StoredReportSection = Omit<ReportSection, "id"> & { id?: string };

/** Mint a fresh, unique Section id. The one place a real id is generated. */
export const newSectionId = (): string => crypto.randomUUID();

/**
 * Backfill a stable `id` onto any Section that lacks one (a pre-#467 saved
 * report), leaving Sections that already have an id untouched. This is the
 * migration-safe load step: legacy rows become fully-identified `ReportSection`s
 * in memory without rewriting what is on disk until the next save.
 *
 * The `||` (not `??`) is deliberate: it heals an *empty-string* id as well as a
 * missing one. This helper's whole job is to guarantee every Section has a
 * usable, non-empty identity — an `id: ""` that ever slipped onto disk would
 * otherwise become an empty (and duplicate) React/dnd key, the exact failure
 * #467 set out to remove. A real id from `newSectionId` is a UUID, never falsy.
 */
export function ensureSectionIds(
  sections: StoredReportSection[],
  makeId: () => string = newSectionId,
): ReportSection[] {
  return sections.map((section) => ({
    ...section,
    id: section.id || makeId(),
  }));
}

export function buildInitialSections(
  template?: PhotoReportTemplate | null,
  makeId: () => string = newSectionId,
): ReportSection[] {
  if (!template) return [];
  const templateSections = (template.sections ?? []) as {
    title?: string;
    description?: string;
  }[];
  return templateSections.map((section) => ({
    id: makeId(),
    title: section.title ?? "",
    description: section.description ?? "",
    photo_ids: [],
  }));
}
