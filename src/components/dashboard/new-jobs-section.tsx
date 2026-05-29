"use client";

import Link from "next/link";
import { Briefcase, ChevronRight } from "lucide-react";
import type { Job } from "@/lib/types";

interface NewJobsSectionProps {
  jobs: Job[];
  total: number;
}

const PREVIEW_CAP = 3;

export function NewJobsSection({ jobs, total }: NewJobsSectionProps) {
  const preview = jobs.slice(0, PREVIEW_CAP);
  const overflow = total - PREVIEW_CAP;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-foreground">New jobs</h2>
          <span
            data-testid="new-jobs-count"
            className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary"
          >
            {total}
          </span>
        </div>
        <Link
          href="/jobs"
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          View all jobs →
        </Link>
      </header>

      {total === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground/70">
          No new jobs.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {preview.map((job) => {
            const contactName = job.contact?.full_name;
            return (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
                      <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                        {job.property_address}
                      </p>
                    )}
                  </div>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
          {overflow > 0 && (
            <li>
              <Link
                href="/jobs"
                className="block px-5 py-2.5 text-center text-sm font-medium text-primary transition-colors hover:bg-primary/5"
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
