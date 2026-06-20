"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Job } from "@/lib/types";
import { urgencyColors, urgencyLabels } from "@/lib/badge-colors";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";
import { JobStageStripe } from "@/components/job-stage-stripe";

// Column widths shared by the header and the rows so the two stay aligned.
// The three badge columns collapse below the sm breakpoint (phone width).
const columns = {
  jobNumber: "w-20 shrink-0",
  contact: "w-44 shrink-0",
  address: "min-w-0 flex-1",
  status: "hidden w-28 shrink-0 sm:block",
  urgency: "hidden w-24 shrink-0 sm:block",
  damage: "hidden w-24 shrink-0 sm:block",
};

const badgeClass = "text-[11px] font-medium px-2 py-0.5 rounded-md";

// Solid edge-stripe color per urgency — the phone-width stand-in for the
// urgency badge, which is hidden below the sm breakpoint.
const urgencyStripeColors: Record<Job["urgency"], string> = {
  emergency: "bg-red-500",
  urgent: "bg-amber-500",
  scheduled: "bg-sky-500",
};

/**
 * Column-label row for the Jobs tab List view. Labels only — the List
 * view shares the Cards sort (emergencies first, then newest) and is not
 * sortable by column, so nothing here is clickable.
 */
export function JobListHeader() {
  return (
    <div className="flex items-center gap-4 border border-transparent px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      <span className={columns.jobNumber}>Job #</span>
      <span className={columns.contact}>Contact</span>
      <span className={columns.address}>Address</span>
      <span className={columns.status}>Status</span>
      <span className={columns.urgency}>Urgency</span>
      <span className={columns.damage}>Damage</span>
    </div>
  );
}

/**
 * One dense row in the Jobs tab List view: job number, contact, and
 * property address, plus colored status / urgency / damage-type badges.
 * On phone-width screens the badge columns collapse and a colored
 * left-edge stripe carries the urgency instead, so the row stays
 * readable without scrolling sideways.
 */
export default function JobListRow({ job }: { job: Job }) {
  const {
    getStatusColor,
    getStatusLabel,
    getDamageTypeColor,
    getDamageTypeLabel,
  } = useConfig();
  const isCompleted =
    job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact ? job.contact.full_name : "Unknown";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "relative flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 transition-all hover:border-primary/30 hover:shadow-sm",
        isCompleted && "opacity-60",
      )}
    >
      {/* Always-on stage color stripe at the very left edge. */}
      <JobStageStripe status={job.status} className="rounded-l-lg" />
      {/* Phone-only urgency stripe — the stand-in for the urgency badge that
          is hidden below the sm breakpoint. It sits just inside the stage
          stripe (left-1, no corner rounding) so both read side by side. */}
      <span
        aria-hidden
        data-testid="urgency-stripe"
        className={cn(
          "absolute inset-y-0 left-1 w-1 sm:hidden",
          urgencyStripeColors[job.urgency],
        )}
      />
      <span
        className={cn(
          columns.jobNumber,
          "truncate font-mono text-xs text-muted-foreground",
        )}
      >
        {job.job_number}
      </span>
      <span
        className={cn(
          columns.contact,
          "truncate text-sm font-semibold text-foreground",
        )}
      >
        {contactName}
      </span>
      <span
        className={cn(
          columns.address,
          "truncate text-sm text-muted-foreground",
        )}
      >
        {job.property_address}
      </span>
      <span className={columns.status}>
        <Badge
          variant="secondary"
          className={cn(badgeClass, getStatusColor(job.status))}
        >
          {getStatusLabel(job.status)}
        </Badge>
      </span>
      <span className={columns.urgency}>
        <Badge
          variant="secondary"
          className={cn(badgeClass, urgencyColors[job.urgency])}
        >
          {urgencyLabels[job.urgency]}
        </Badge>
      </span>
      <span className={columns.damage}>
        <Badge
          variant="secondary"
          className={cn(badgeClass, getDamageTypeColor(job.damage_type))}
        >
          {getDamageTypeLabel(job.damage_type)}
        </Badge>
      </span>
    </Link>
  );
}
