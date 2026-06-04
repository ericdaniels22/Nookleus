// Issue #400 — Photo Report Rework, Slice 2a.
//
// A Photo Report is numbered per Job ("Report #1, #2, ..."). `nextReportNumber`
// is the single, pure place that decides the next number from the numbers a Job
// already has. It is intentionally just the arithmetic — the caller is
// responsible for collecting the Job's existing `report_number` values (and for
// deciding whether trashed reports count). It is max+1, not count+1, so numbers
// are never reused: deleting Report #3 then creating leaves a gap at #3 rather
// than handing #3 to a different report.

/**
 * The next per-Job report number, given the numbers a Job already uses.
 *
 * Empty -> 1; otherwise the highest existing number plus one. Gaps and
 * out-of-order input are tolerated.
 */
export function nextReportNumber(existingNumbers: number[]): number {
  if (existingNumbers.length === 0) return 1;
  return Math.max(...existingNumbers) + 1;
}
