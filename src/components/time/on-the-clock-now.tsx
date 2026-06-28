"use client";

import { useEffect, useMemo, useState } from "react";

import { formatElapsed } from "@/lib/elapsed";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase";
import { useOpenSessions } from "@/lib/timesheets/use-open-sessions";
import type { OpenSessionPresence } from "@/lib/timesheets/load-open-sessions";

// Presence: the owner-dashboard org-wide "On the clock now" panel (#705, epic
// #699). OnTheClockNowView is the pure presentational core — it renders the
// roster from a sessions list plus an injected `nowMs`, so the per-row elapsed
// timer is a pure function of (startedAt, now). The live ticking + realtime +
// permission gating live in the container (OnTheClockNow) below.
//
// ADR 0019: presence shows identity + Job + time only — never location.

function jobLabel(job: OpenSessionPresence["job"]): string {
  return job?.propertyAddress ?? job?.jobNumber ?? "a Job";
}

export function OnTheClockNowView({
  sessions,
  nowMs,
}: {
  sessions: OpenSessionPresence[];
  nowMs: number;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        On the clock now
      </h2>
      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No one&apos;s on the clock right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.sessionId}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {s.workerName ?? "A worker"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {jobLabel(s.job)}
                  </span>
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-sm font-medium text-muted-foreground">
                {formatElapsed(nowMs - new Date(s.startedAt).getTime())}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Container: the owner-dashboard panel. Gated on the NEW view_timesheets
// permission — absent (and non-subscribing) for anyone without it, e.g. a
// crew_member. Owns one `now` that ticks every 30s (formatElapsed is
// minute-granular) so every row's elapsed timer counts up together.
export default function OnTheClockNow() {
  const { hasPermission, organizationId } = useAuth();
  const canView = hasPermission("view_timesheets");

  // A stable client identity across renders — a fresh one each render would
  // re-fire the hook's subscribe effect.
  const supabase = useMemo(() => createClient(), []);

  // Rules of hooks: call the realtime hook unconditionally, but starve it of an
  // org when the worker can't view timesheets so it opens no channel.
  const { sessions } = useOpenSessions({
    supabase,
    organizationId: canView ? organizationId : null,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!canView) return null;

  return <OnTheClockNowView sessions={sessions} nowMs={now} />;
}
