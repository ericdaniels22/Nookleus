"use client";

interface StatStripProps {
  newJobsCount: number;
  canViewJobs: boolean;
  unreadResponsesCount: number;
  canViewEmail: boolean;
}

export function StatStrip({
  newJobsCount,
  canViewJobs,
  unreadResponsesCount,
  canViewEmail,
}: StatStripProps) {
  return (
    <div role="presentation">
      {canViewJobs && (
        <span data-testid="stat-strip-new-jobs">{newJobsCount} new jobs</span>
      )}
      {canViewEmail && (
        <span data-testid="stat-strip-unread-responses">
          {unreadResponsesCount} unread responses
        </span>
      )}
    </div>
  );
}
