"use client";

import { useMemo } from "react";

import { createClient } from "@/lib/supabase";
import { useOpenSessions } from "@/lib/timesheets/use-open-sessions";

// Presence: the per-Job "On site now" indicator (#705, epic #699). Shows which
// app Users are On the clock at THIS Job — NAMES ONLY, no hour totals, no
// location (ADR 0019). Rides the Job page and Job card, both already gated by
// view_jobs, so it has no permission gate of its own.
//
// OnSiteNowView is the pure presentational core; the realtime wiring lives in
// the container (OnSiteNow) below.

export function OnSiteNowView({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-0.5 text-xs font-medium text-accent-text">
      <span
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
        aria-hidden
      />
      <span className="truncate">On site now: {names.join(", ")}</span>
    </span>
  );
}

// Container: binds the per-Job realtime roster to the indicator. The org is
// sourced from the Job itself (job.organization_id); the hook scopes to this
// Job and re-hydrates live. No permission gate — view_jobs already guards the
// surfaces this rides on.
export default function OnSiteNow({
  organizationId,
  jobId,
}: {
  organizationId: string | null;
  jobId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { sessions } = useOpenSessions({ supabase, organizationId, jobId });
  const names = sessions.map((s) => s.workerName ?? "A worker");
  return <OnSiteNowView names={names} />;
}
