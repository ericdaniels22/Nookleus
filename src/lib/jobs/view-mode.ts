export type JobsViewMode = "grid" | "comfortable" | "list";

/** localStorage key holding the Jobs tab's per-device view-mode preference. */
export const JOBS_VIEW_MODE_STORAGE_KEY = "jobs-view-mode";

const JOBS_VIEW_MODES: readonly JobsViewMode[] = [
  "grid",
  "comfortable",
  "list",
];

export function parseJobsViewMode(
  raw: string | null | undefined,
): JobsViewMode {
  if (raw && (JOBS_VIEW_MODES as readonly string[]).includes(raw)) {
    return raw as JobsViewMode;
  }
  return "grid";
}
