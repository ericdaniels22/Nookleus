"use client";

import Link from "next/link";

import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One dense row in the Jobs tab List view. This slice shows the core
 * identifying fields; status/urgency/damage columns are added in #161.
 */
export default function JobListRow({ job }: { job: Job }) {
  const isCompleted =
    job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact ? job.contact.full_name : "Unknown";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 transition-all hover:border-primary/30 hover:shadow-sm",
        isCompleted && "opacity-60",
      )}
    >
      <span className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {job.job_number}
      </span>
      <span className="w-44 shrink-0 truncate text-sm font-semibold text-foreground">
        {contactName}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {job.property_address}
      </span>
    </Link>
  );
}
