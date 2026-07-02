"use client";

import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import type { Job } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface NewJobsSectionProps {
  jobs: Job[];
  total: number;
  loading?: boolean;
  error?: string | null;
}

const PREVIEW_CAP = 3;

// Skeleton rows mirror the final row silhouette (icon tile + name/number line
// + address line) so loading reads as the same shape the data will fill.
function NewJobsSkeleton() {
  return (
    <ul className="divide-y divide-border-subtle">
      {Array.from({ length: PREVIEW_CAP }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NewJobsSection({
  jobs,
  total,
  loading = false,
  error = null,
}: NewJobsSectionProps) {
  const preview = jobs.slice(0, PREVIEW_CAP);
  const overflow = total - PREVIEW_CAP;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-foreground">New jobs</h2>
          {!loading && !error && (
            <span
              data-testid="new-jobs-count"
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent-tint px-1.5 text-xs font-semibold text-accent-text"
            >
              {total}
            </span>
          )}
        </div>
        <Link
          href="/jobs"
          className="shrink-0 text-sm font-medium text-accent-text hover:underline"
        >
          View all jobs →
        </Link>
      </header>

      {loading ? (
        <NewJobsSkeleton />
      ) : error ? (
        <p className="px-5 py-8 text-center text-[13px] text-destructive">
          Couldn&apos;t load new jobs. It&apos;ll retry shortly.
        </p>
      ) : total === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No new jobs"
          description="New jobs will show up here as they come in."
          action={
            <Link
              href="/intake"
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Start an intake →
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {preview.map((job) => {
            const contactName = job.contact?.full_name;
            return (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text">
                    <Briefcase size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {contactName && (
                        <p className="min-w-0 truncate text-sm font-medium text-foreground">
                          {contactName}
                        </p>
                      )}
                      <p className="shrink-0 font-mono text-xs text-muted-foreground">
                        {job.job_number}
                      </p>
                    </div>
                    {job.property_address && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {job.property_address}
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
          {overflow > 0 && (
            <li>
              <Link
                href="/jobs"
                className="block px-5 py-2.5 text-center text-sm font-medium text-accent-text transition-colors hover:bg-muted"
              >
                + {overflow} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
