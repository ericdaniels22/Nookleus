"use client";

import { Briefcase, Mail } from "lucide-react";

interface StatStripProps {
  newJobsCount: number;
  canViewJobs: boolean;
  unreadResponsesCount: number;
  canViewEmail: boolean;
}

// Compact one-row strip: "<N> new jobs · <N> unread responses". Each column
// hides when the viewer lacks the gating permission, so the `·` divider only
// renders when both columns are present. Counts stay in a single text node so
// the stat-strip tests can match the "<N> new jobs" copy.
export function StatStrip({
  newJobsCount,
  canViewJobs,
  unreadResponsesCount,
  canViewEmail,
}: StatStripProps) {
  return (
    <div
      role="presentation"
      className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
    >
      {canViewJobs && (
        <span
          data-testid="stat-strip-new-jobs"
          className="inline-flex items-center gap-1.5 font-medium text-foreground"
        >
          <Briefcase size={15} className="text-primary" />
          {`${newJobsCount} new jobs`}
        </span>
      )}
      {canViewJobs && canViewEmail && (
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
      )}
      {canViewEmail && (
        <span
          data-testid="stat-strip-unread-responses"
          className="inline-flex items-center gap-1.5 font-medium text-foreground"
        >
          <Mail size={15} className="text-primary" />
          {`${unreadResponsesCount} unread responses`}
        </span>
      )}
    </div>
  );
}
