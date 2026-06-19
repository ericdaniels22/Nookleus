// Issue #723 — Jobs page stage-grouped sections (presentational component).
//
// Renders the sections from buildJobSections as colored stage headers carrying
// a count, then delegates each section's Job rendering to the `renderJobs`
// prop — so grouping stays orthogonal to the page's view-mode (grid / list /
// comfortable) and this component stays free of data fetching.

import type { ReactNode } from "react";
import type { Job } from "@/lib/types";
import type { JobSection } from "@/lib/jobs/build-job-sections";

interface JobStageSectionsProps {
  sections: JobSection[];
  /** Renders a section's Jobs in the page's current view-mode layout. */
  renderJobs: (jobs: Job[]) => ReactNode;
}

export function JobStageSections({
  sections,
  renderJobs,
}: JobStageSectionsProps) {
  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.key} data-testid={`section-${section.key}`}>
          <div
            className="mb-3 flex items-center gap-2 border-b pb-2"
            style={{ borderColor: `${section.presentation.accentColor}33` }}
          >
            <h2
              className="text-sm font-bold uppercase tracking-wide"
              style={{ color: section.presentation.accentColor }}
            >
              {section.presentation.label}
            </h2>
            <span
              data-testid={`section-${section.key}-count`}
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{
                backgroundColor: section.presentation.badge.bg,
                color: section.presentation.badge.text,
              }}
            >
              {section.count}
            </span>
          </div>
          {renderJobs(section.jobs)}
        </section>
      ))}
    </div>
  );
}
