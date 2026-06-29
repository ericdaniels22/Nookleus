"use client";

import { useCallback, useEffect, useState } from "react";
import { Star, MessageSquare, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

// Issue #605 (parent PRD #603, ADR 0015) — Marketing suite: manual review
// request from the Job page.
//
// Admin-only section that lets an admin send the Job's customer the
// Organization's Google review link (by SMS or, when there's no usable mobile,
// by email — the channel is decided server-side) and shows the send history.
// Before asking a customer who was already asked, it surfaces a confirm step
// (the route returns 409 with the prior-send summary; "Send anyway" re-posts
// with `acknowledged`). There are NO automatic sends — only this button.

interface ReviewRequestRow {
  id: string;
  channel: "sms" | "email";
  sent_to: string;
  review_link: string;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  created_at: string;
}

interface PriorSummary {
  alreadyRequested: boolean;
  count: number;
  last: {
    channel: "sms" | "email";
    created_at: string;
    sender_name?: string | null;
  } | null;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ReviewRequestSection({ jobId }: { jobId: string }) {
  const { profile, loading } = useAuth();
  // Marketing is an admin surface (matches the route's adminOnly gate and the
  // review_requests admin-only insert policy).
  const isAdmin = !loading && profile?.role === "admin";

  const [history, setHistory] = useState<ReviewRequestRow[]>([]);
  const [sending, setSending] = useState(false);
  // Set to the prior-send summary when the route asks us to confirm a repeat.
  const [confirm, setConfirm] = useState<PriorSummary | null>(null);

  const fetchHistory = useCallback(async () => {
    const res = await fetch(
      `/api/jobs/${encodeURIComponent(jobId)}/review-request`,
    );
    if (!res.ok) return;
    const data = (await res.json()) as ReviewRequestRow[];
    setHistory(Array.isArray(data) ? data : []);
  }, [jobId]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchHistory();
  }, [isAdmin, fetchHistory]);

  const send = useCallback(
    async (acknowledged: boolean) => {
      setSending(true);
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}/review-request`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(acknowledged ? { acknowledged: true } : {}),
          },
        );
        // 409 — already asked. Surface the warning and let the admin confirm.
        if (res.status === 409) {
          const data = (await res.json().catch(() => ({}))) as {
            summary?: PriorSummary;
          };
          if (data.summary) setConfirm(data.summary);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          channel?: "sms" | "email";
        };
        if (!res.ok) {
          toast.error(data.error || "Could not send the review request.");
          return;
        }
        setConfirm(null);
        const via = data.channel === "email" ? "email" : "text message";
        toast.success(`Review request sent by ${via}.`);
        void fetchHistory();
      } catch {
        toast.error("Could not send the review request.");
      } finally {
        setSending(false);
      }
    },
    [jobId, fetchHistory],
  );

  if (!isAdmin) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          <Star size={16} className="inline mr-2 -mt-0.5" />
          Reviews ({history.length})
        </h3>
        {!confirm && (
          <button
            onClick={() => void send(false)}
            disabled={sending}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-colors gap-1.5 disabled:opacity-60"
          >
            <Star size={14} />
            {sending ? "Sending…" : "Request review"}
          </button>
        )}
      </div>

      {confirm && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30 p-4">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            This customer has already been asked for a review
            {confirm.count > 1 ? ` ${confirm.count} times` : ""}
            {confirm.last
              ? `, last on ${formatWhen(confirm.last.created_at)}${
                  confirm.last.sender_name ? ` by ${confirm.last.sender_name}` : ""
                }`
              : ""}
            . Send another request?
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => void send(true)}
              disabled={sending}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-amber-600 text-white shadow-sm hover:bg-amber-700 transition-colors disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send anyway"}
            </button>
            <button
              onClick={() => setConfirm(null)}
              disabled={sending}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-border bg-background text-foreground shadow-sm hover:bg-accent transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {history.length > 0 ? (
        <div className="space-y-2">
          {history.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                {row.channel === "email" ? (
                  <Mail
                    size={14}
                    className="text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <MessageSquare
                    size={14}
                    className="text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="sr-only">
                  {row.channel === "email" ? "Sent by email" : "Sent by text"}
                </span>
                <span className="text-sm text-foreground truncate">
                  {row.sent_to}
                </span>
              </div>
              <div className="text-xs text-muted-foreground/70 text-right shrink-0 ml-3">
                {formatWhen(row.created_at)}
                {row.sent_by_name ? ` · ${row.sent_by_name}` : ""}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <Star size={32} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground/60">
            No review requests sent for this job yet.
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            Send the customer your Google review link using the button above.
          </p>
        </div>
      )}
    </div>
  );
}
