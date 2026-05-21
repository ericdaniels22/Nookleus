"use client";

import Link from "next/link";
import { format } from "date-fns";
import { ImageOff } from "lucide-react";

import { resolveCoverPhotoUrl } from "@/lib/jobs/cover-photo";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * One roomy row in the Jobs tab Comfortable view: a square cover photo,
 * the job number and contact name, the property address, and the
 * last-updated date. The whole row links to the job. Status/urgency/
 * damage badges and the photo/file counts are added later (#163).
 */
export default function JobComfortableRow({ job }: { job: Job }) {
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
      </div>

      <span className="shrink-0 text-xs text-muted-foreground">
        {format(new Date(job.updated_at), "MMM d, yyyy")}
      </span>
    </Link>
  );
}
