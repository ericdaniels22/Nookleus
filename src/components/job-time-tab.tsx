"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { formatElapsed } from "@/lib/elapsed";
import { useOnTheClock } from "@/lib/on-the-clock-context";
import ClockInConfirmation from "@/components/time/clock-in-confirmation";
import { NeedsAttentionList } from "@/components/time/needs-attention-list";
import { captureLabel } from "@/lib/timesheets/capture-marker";
import type { CaptureMarker } from "@/lib/timesheets/timesheet-aggregator";

// The Job detail "Time" tab (issue #701, `?tab=time`). A worker can Clock in to
// THIS Job directly (the Job is known, so no picker — straight to the
// confirmation) and review their OWN recorded hours for it. They never see
// other workers' sessions: the /api/time/sessions endpoint filters to the
// caller's own user_id.

interface RecordedSession {
  sessionId: string;
  jobId: string;
  startedAt: string;
  endedAt: string | null;
  // The capture marker (#706, AC4) — 'live' vs 'hand'. A hand-entered or
  // corrected session shows a visible "Hand-entered" badge.
  capture: CaptureMarker;
}

function formatRange(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const day = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endedAt) return `${day} · ${startTime} – now`;
  const endTime = new Date(endedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${startTime} – ${endTime}`;
}

function duration(session: RecordedSession): string {
  if (!session.endedAt) return "Open";
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
  return formatElapsed(ms);
}

export default function JobTimeTab({
  job,
}: {
  job: { id: string; property_address: string; job_number: string };
}) {
  const { active, canTrackTime } = useOnTheClock();
  const [sessions, setSessions] = useState<RecordedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const onThisJob = active?.jobId === job.id;

  const load = useCallback(async () => {
    if (!canTrackTime) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/time/sessions?jobId=${encodeURIComponent(job.id)}`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { sessions: RecordedSession[] };
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [canTrackTime, job.id]);

  // Reload when the worker's clock state changes (a new clock-in/out here or
  // elsewhere) so this Job's hours stay current.
  useEffect(() => {
    void load();
  }, [load, active]);

  if (!canTrackTime) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Time tracking isn&apos;t enabled for your account.
      </p>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        {onThisJob ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
            <p className="text-sm font-medium">You&apos;re on the clock for this Job.</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-emerald-700"
          >
            <Clock size={18} />
            Clock in to this Job
          </button>
        )}
      </div>

      {/* The lead's needs-attention surface for this Job (#706, AC5). Self-
          gating on manage_timesheets — a crew member renders nothing here. */}
      <div className="mb-6">
        <NeedsAttentionList jobId={job.id} />
      </div>

      <h3 className="mb-3 text-sm font-semibold text-foreground">Your recorded hours</h3>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No recorded hours yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sessions.map((session) => (
            <li
              key={session.sessionId}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                {formatRange(session.startedAt, session.endedAt)}
                {captureLabel(session.capture) && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                    {captureLabel(session.capture)}
                  </span>
                )}
              </span>
              <span
                className={
                  session.endedAt
                    ? "font-semibold tabular-nums text-foreground"
                    : "font-semibold text-emerald-600"
                }
              >
                {duration(session)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <ClockInConfirmation
          job={job}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
