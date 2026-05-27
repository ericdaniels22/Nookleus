"use client";

import Link from "next/link";
import type { Job } from "@/lib/types";

interface NewJobsSectionProps {
  jobs: Job[];
  total: number;
}

const PREVIEW_CAP = 3;

export function NewJobsSection({ jobs, total }: NewJobsSectionProps) {
  if (total === 0) {
    return <p>No new jobs.</p>;
  }

  const preview = jobs.slice(0, PREVIEW_CAP);
  const overflow = total - PREVIEW_CAP;

  return (
    <section>
      <header>
        <h2>New jobs</h2>
        <span data-testid="new-jobs-count">{total}</span>
        <Link href="/jobs">View all jobs →</Link>
      </header>
      <ul>
        {preview.map((job) => (
          <li key={job.id}>
            <Link href={`/jobs/${job.id}`}>
              <p>{job.job_number}</p>
            </Link>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <Link href="/jobs">+ {overflow} more</Link>
      )}
    </section>
  );
}
