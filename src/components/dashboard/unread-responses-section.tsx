"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Mail, MailCheck, Clock } from "lucide-react";
import type { UnreadResponseThread } from "@/lib/dashboard/use-dashboard-data";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export type { UnreadResponseThread };

interface UnreadResponsesSectionProps {
  threads: UnreadResponseThread[];
  total: number;
  loading?: boolean;
  error?: string | null;
}

const PREVIEW_CAP = 3;

// Skeleton rows mirror the final row silhouette (avatar tile + sender/subject
// lines) so loading reads as the same shape the data will fill.
function UnreadResponsesSkeleton() {
  return (
    <ul className="divide-y divide-border">
      {Array.from({ length: PREVIEW_CAP }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-3">
          <Skeleton className="mt-0.5 h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-48" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function UnreadResponsesSection({
  threads,
  total,
  loading = false,
  error = null,
}: UnreadResponsesSectionProps) {
  const preview = threads.slice(0, PREVIEW_CAP);
  const overflow = total - PREVIEW_CAP;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold text-foreground">
            People to respond to
          </h2>
          {!loading && !error && (
            <span
              data-testid="unread-responses-count"
              className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary"
            >
              {total}
            </span>
          )}
        </div>
        <Link
          href="/email"
          className="shrink-0 text-sm font-medium text-primary hover:underline"
        >
          Open inbox →
        </Link>
      </header>

      {loading ? (
        <UnreadResponsesSkeleton />
      ) : error ? (
        <p className="px-5 py-8 text-center text-[13px] text-destructive">
          Couldn&apos;t load unread responses. It&apos;ll retry shortly.
        </p>
      ) : total === 0 ? (
        <EmptyState
          icon={MailCheck}
          title="You're all caught up"
          description="New replies on shared inboxes will show up here."
          action={
            <Link
              href="/email"
              className="text-sm font-medium text-primary hover:underline"
            >
              Open inbox →
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {preview.map((thread) => {
            const sender = thread.latest_from_name ?? thread.latest_from_address;
            return (
              <li key={thread.thread_id}>
                <Link
                  href={`/email?id=${thread.latest_email_id}`}
                  className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-primary/5"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {sender}
                      </p>
                      {thread.unread_count > 1 && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {`${thread.unread_count} unread`}
                        </span>
                      )}
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60">
                        <Clock size={11} />
                        {format(new Date(thread.latest_received_at), "MMM d")}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-foreground/80">
                      {thread.latest_subject}
                    </p>
                    {thread.latest_snippet && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
                        {thread.latest_snippet}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
          {overflow > 0 && (
            <li>
              <Link
                href="/email"
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
