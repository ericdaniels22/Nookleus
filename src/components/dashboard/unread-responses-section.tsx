"use client";

import Link from "next/link";
import type { UnreadResponseThread } from "@/lib/dashboard/use-dashboard-data";

export type { UnreadResponseThread };

interface UnreadResponsesSectionProps {
  threads: UnreadResponseThread[];
  total: number;
}

const PREVIEW_CAP = 3;

export function UnreadResponsesSection({ threads, total }: UnreadResponsesSectionProps) {
  if (total === 0) {
    return <p>No unread responses on shared inboxes.</p>;
  }

  const preview = threads.slice(0, PREVIEW_CAP);
  const overflow = total - PREVIEW_CAP;

  return (
    <section>
      <header>
        <h2>People to respond to</h2>
        <span data-testid="unread-responses-count">{total}</span>
        <Link href="/email">Open inbox →</Link>
      </header>
      <ul>
        {preview.map((thread) => (
          <li key={thread.thread_id}>
            <Link href={`/email?id=${thread.latest_email_id}`}>
              <p>{thread.latest_from_name ?? thread.latest_from_address}</p>
              <p>{thread.latest_subject}</p>
              {thread.latest_snippet && <p>{thread.latest_snippet}</p>}
              {thread.unread_count > 1 && (
                <span>{thread.unread_count} unread</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <Link href="/email">+ {overflow} more</Link>
      )}
    </section>
  );
}
