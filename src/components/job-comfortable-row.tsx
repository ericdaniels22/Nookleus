"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ImageOff, Image as ImageIcon, Paperclip } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { resolveCoverPhotoUrl } from "@/lib/jobs/cover-photo";
import { urgencyColors, urgencyLabels } from "@/lib/badge-colors";
import { useConfig } from "@/lib/config-context";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const badgeClass = "text-[11px] font-medium px-2 py-0.5 rounded-md";

/**
 * One roomy row in the Jobs tab Comfortable view: a square cover photo,
 * the job number and contact name, the property address, colored
 * status / urgency / damage-type badges, and a photo count plus file
 * count. The whole row links to the job. On phone-width screens the
 * counts hide while the cover, name/address, and badges stay.
 */
export default function JobComfortableRow({ job }: { job: Job }) {
  const {
    getStatusColor,
    getStatusLabel,
    getDamageTypeColor,
    getDamageTypeLabel,
  } = useConfig();
  const isCompleted =
    job.status === "completed" || job.status === "cancelled";
  const contactName = job.contact ? job.contact.full_name : "Unknown";
  const coverUrl = resolveCoverPhotoUrl(job.cover_photo, SUPABASE_URL);

  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/30 hover:shadow-sm",
        isCompleted && "opacity-60",
      )}
    >
      {coverUrl ? (
        // Plain <img> with native lazy loading: the cover is a Supabase
        // public URL, matching how job-photos-tab.tsx renders photos.
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted"
          aria-hidden="true"
        >
          <ImageOff size={20} className="text-muted-foreground/40" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-muted-foreground">
          {job.job_number}
        </p>
        <p className="truncate text-sm font-semibold text-foreground">
          {contactName}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {job.property_address}
        </p>
        {/* Badges sit under the address so they stay visible on a
            phone-width row, where the count column is hidden. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge
            variant="secondary"
            className={cn(badgeClass, getStatusColor(job.status))}
          >
            {getStatusLabel(job.status)}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(badgeClass, urgencyColors[job.urgency])}
          >
            {urgencyLabels[job.urgency]}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(badgeClass, getDamageTypeColor(job.damage_type))}
          >
            {getDamageTypeLabel(job.damage_type)}
          </Badge>
        </div>
      </div>

      {/* Photo / file counts — an at-a-glance signal of how documented
          the job is. */}
      <div
        data-testid="job-counts"
        className="hidden shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground sm:flex"
      >
        <span className="flex items-center gap-1">
          <ImageIcon size={13} className="shrink-0" aria-hidden="true" />
          <span aria-label="Photos">{job.photo_count ?? 0}</span>
        </span>
        <span className="flex items-center gap-1">
          <Paperclip size={13} className="shrink-0" aria-hidden="true" />
          <span aria-label="Files">{job.file_count ?? 0}</span>
        </span>
      </div>

      <span className="shrink-0 text-xs text-muted-foreground">
        {format(new Date(job.updated_at), "MMM d, yyyy")}
      </span>
    </Link>
  );
}
