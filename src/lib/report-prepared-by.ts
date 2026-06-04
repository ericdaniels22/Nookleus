// Issue #400 — Photo Report Rework, Slice 2a.
//
// `formatPreparedBy` turns a report's `created_by` value into the cover page's
// "Prepared by {name}" line. It is read-tolerant: a real name (including the
// legacy single-name 'Eric' rows) yields the line; a blank/missing value
// yields null so the cover page renders nothing rather than "Prepared by".

/**
 * The "Prepared by {name}" line for a report, or null when there is no name.
 */
export function formatPreparedBy(
  createdBy: string | null | undefined,
): string | null {
  const name = createdBy?.trim();
  if (!name) return null;
  return `Prepared by ${name}`;
}
