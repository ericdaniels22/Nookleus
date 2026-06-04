// Issue #402 — Photo Report Rework, Slice 2c.
//
// The recoverable-trash split for Photo Reports. A report is "active" while its
// `deleted_at` is null and "trashed" once it carries a timestamp — the same
// canonical rule the rest of the platform uses for a soft-deleted row
// (`deleted_at IS NULL`, the Active-job rule). Keeping that decision in one pure
// place means the Overview list, the trash view, and any future guard all agree
// on what counts as active.

/** The single field the trash split reads. */
export interface TrashableReport {
  deleted_at: string | null;
}

/** A Photo Report is active until it has been moved to the trash. */
export function isActivePhotoReport(report: TrashableReport): boolean {
  return report.deleted_at === null;
}

/** A Photo Report is trashed once it carries a `deleted_at` timestamp. */
export function isTrashedPhotoReport(report: TrashableReport): boolean {
  return !isActivePhotoReport(report);
}

/**
 * Split a mixed report list into the active rows and the trashed rows,
 * preserving the input order within each bucket. The Overview fetches a Job's
 * reports once and partitions here, so the always-visible active list and the
 * trash disclosure are two views of the same fetch rather than two queries.
 */
export function partitionPhotoReportsByTrash<T extends TrashableReport>(
  reports: T[],
): { active: T[]; trashed: T[] } {
  const active: T[] = [];
  const trashed: T[] = [];
  for (const report of reports) {
    (isActivePhotoReport(report) ? active : trashed).push(report);
  }
  return { active, trashed };
}
