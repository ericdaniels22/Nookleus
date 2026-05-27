"use client";

interface StatStripProps {
  newJobsCount: number;
  canViewJobs: boolean;
}

export function StatStrip({ newJobsCount, canViewJobs }: StatStripProps) {
  return (
    <div role="presentation">
      {canViewJobs && (
        <span data-testid="stat-strip-new-jobs">{newJobsCount} new jobs</span>
      )}
    </div>
  );
}
