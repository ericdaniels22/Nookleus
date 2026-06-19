// Issue #723 — Jobs page stage-grouped sections.
//
// The pure sort-and-group function behind the Jobs page's stage sections:
// groups Jobs by their frozen status key (ADR 0022) into the page's display
// order, sourcing each section's label/color/icon from the #720
// status-presentation module.
//
// The section order is Active-first — the work-priority order the owner agreed
// for the Jobs page — which is intentionally NOT the module's lifecycle
// sortRank (Lead-first, used by the status picker). So the order lives here, as
// the page's own concern; the module remains the source of presentation facets.

import type { Job } from "@/lib/types";
import {
  getJobStatusPresentation,
  isOpenJobStatus,
  type JobStatusPresentation,
} from "@/lib/job-status-presentation";

/** Jobs-page section display order: Active → Lead → Collections → Closed → Lost. */
const SECTION_ORDER = [
  "in_progress",
  "new",
  "pending_invoice",
  "completed",
  "cancelled",
] as const;

export interface JobSection {
  /** Frozen snake_case status key (ADR 0022). */
  key: string;
  /** Label / accent color / icon for the section header (from the #720 module). */
  presentation: JobStatusPresentation;
  /** The section's Jobs. */
  jobs: Job[];
  /** Number of Jobs in the section (what the header badge shows). */
  count: number;
}

export function buildJobSections(jobs: Job[]): JobSection[] {
  return SECTION_ORDER.map((key) => {
    const sectionJobs = jobs
      .filter((job) => job.status === key)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    return {
      key,
      presentation: getJobStatusPresentation(key),
      jobs: sectionJobs,
      count: sectionJobs.length,
    };
    // Empty stages get no header — hidden until they hold at least one Job.
  }).filter((section) => section.count > 0);
}

/**
 * Count of Open jobs — the headline "Open jobs" stat. Open = the Lead, Active,
 * and Collections stages (per the #720 module's isOpen verdict); Closed and
 * Lost don't count.
 */
export function countOpenJobs(
  jobs: ReadonlyArray<{ status: string }>,
): number {
  return jobs.filter((job) => isOpenJobStatus(job.status)).length;
}
