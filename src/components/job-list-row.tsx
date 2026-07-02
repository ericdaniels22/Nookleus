"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Job } from "@/lib/types";
import {
  urgencyColors,
  urgencyLabels,
  resolveDamageTypeBadge,
  resolveStatusBadge,
} from "@/lib/badge-colors";
import { useConfig } from "@/lib/config-context";
import { cn } from "@/lib/utils";
import { JobStageStripe } from "@/components/job-stage-stripe";
import { JobStageIcon } from "@/components/job-stage-icon";

// Per-column sizing shared by the header and the rows so the two stay aligned.
// Widths are `sm:`-prefixed: at phone width the row is a stacked card (§7.1 —
// "tables collapse to card rows") whose two wrappers below are flex/flex-wrap,
// and at sm+ the wrappers become `display:contents` so these columns promote to
// direct row children and line up as a table again.
const columns = {
  jobNumber: "sm:w-20 sm:shrink-0",
  contact: "min-w-0 sm:w-44 sm:shrink-0",
  address: "min-w-0 sm:flex-1",
  // The status column is a flex row so the stage icon (#727) and status badge
  // sit together on every screen; at sm+ it also takes its table-column width.
  status: "flex items-center gap-1.5 sm:w-28 sm:shrink-0",
  urgency: "sm:w-24 sm:shrink-0",
  damage: "sm:w-24 sm:shrink-0",
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
  const { getStatusLabel, getDamageTypeLabel, statuses, damageTypes } =
    useConfig();
  const isCompleted =
    job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact ? job.contact.full_name : "Unknown";

  // §2.6 tint treatment: status stays config-sourced (ADR 0022) but softens
  // into a tint; damage type uses its vivid canonical class unless the org
  // customized the color, in which case that color is softened to stay legible.
  const statusBadge = resolveStatusBadge(job.status, statuses);
  const damageBadge = resolveDamageTypeBadge(job.damage_type, damageTypes);

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        // Phone: a stacked card row (name/address block, then a badge line).
        // sm+: the two wrappers dissolve (`sm:contents`) and this flexes back
        // into an aligned single-line table row.
        "relative flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 transition-all hover:border-primary/30 hover:shadow-sm sm:flex-row sm:items-center sm:gap-4 sm:py-2.5",
        isCompleted && "opacity-60",
      )}
    >
      {/* Always-on stage color stripe at the very left edge. */}
      <JobStageStripe status={job.status} className="rounded-l-lg" />
      {/* Phone urgency stripe — a redundant-with-the-badge but at-a-glance edge
          accent on the card row. It sits just inside the stage stripe (left-1,
          no corner rounding) so both colors read side by side. */}
      <span
        aria-hidden
        data-testid="urgency-stripe"
        className={cn(
          "absolute inset-y-0 left-1 w-1 sm:hidden",
          urgencyStripeColors[job.urgency],
        )}
      />
      {/* Identity — a stacked name/address block on phone; at sm+ this wrapper
          (and its inner job#/contact pair) become `display:contents`, so the
          three fields promote to the first three aligned table columns. */}
      <div className="flex min-w-0 flex-col gap-0.5 sm:contents">
        <div className="flex min-w-0 items-baseline gap-2 sm:contents">
          <span
            className={cn(
              columns.jobNumber,
              "shrink-0 truncate font-mono text-xs text-muted-foreground",
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
        </div>
        <span
          className={cn(
            columns.address,
            "truncate text-sm text-muted-foreground",
          )}
        >
          {job.property_address}
        </span>
      </div>
      {/* Badges — a wrapping cluster on their own line on phone (so the card
          row shows name + badges + one metadata line, #914); at sm+ this
          wrapper dissolves and the three columns line up across every row. */}
      <div className="flex flex-wrap items-center gap-1.5 sm:contents">
        <span className={columns.status}>
          <JobStageIcon status={job.status} className="text-muted-foreground" />
          <Badge
            variant="secondary"
            className={cn(badgeClass, statusBadge.className)}
            style={statusBadge.style}
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
            className={cn(badgeClass, damageBadge.className)}
            style={damageBadge.style}
          >
            {getDamageTypeLabel(job.damage_type)}
          </Badge>
        </span>
      </div>
    </Link>
  );
}
