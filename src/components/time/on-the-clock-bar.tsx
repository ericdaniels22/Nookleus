"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { formatElapsed } from "@/lib/elapsed";
import { useOnTheClock } from "@/lib/on-the-clock-context";

// The persistent app-wide "On the clock" status bar (issue #701). This file's
// presentational core, OnTheClockBarView, is pure: it renders the bar from the
// session label + a pre-formatted elapsed string, or nothing when the worker is
// not clocked in. The live elapsed ticking and the /api/time wiring live in the
// container (OnTheClockBar) below.

export interface OnTheClockSession {
  /** What to show after "On " — e.g. the Job's property address. */
  addressLabel: string;
}

export function OnTheClockBarView({
  session,
  elapsedLabel,
  onClockOut,
  busy,
}: {
  session: OnTheClockSession | null;
  elapsedLabel: string;
  onClockOut: () => void;
  busy?: boolean;
}) {
  if (!session) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-primary-foreground/20 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg pb-[calc(0.625rem+env(safe-area-inset-bottom))]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary-foreground/90" aria-hidden />
        <span className="truncate">On {session.addressLabel}</span>
        <span className="shrink-0 opacity-70" aria-hidden>·</span>
        <span className="shrink-0 tabular-nums opacity-90">{elapsedLabel}</span>
      </span>
      <button
        type="button"
        onClick={onClockOut}
        disabled={busy}
        className="shrink-0 rounded-md bg-primary-foreground/15 px-3 py-1.5 font-semibold hover:bg-primary-foreground/25 disabled:opacity-60"
      >
        Clock out
      </button>
    </div>
  );
}

// Container: the always-mounted, app-wide bar. Reads the shared clock state,
// ticks the elapsed label every 30s (formatElapsed is minute-granular), and
// stops the session on Clock out. Renders nothing until the worker is On the
// clock, so it's invisible the rest of the time.
export default function OnTheClockBar() {
  const { active, clockOut } = useOnTheClock();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const startedMs = new Date(active.startedAt).getTime();
  const elapsedLabel = formatElapsed(now - startedMs);
  const addressLabel = active.job?.property_address ?? "your Job";

  async function handleClockOut() {
    setBusy(true);
    const result = await clockOut();
    setBusy(false);
    if (result.ok) {
      toast.success("Clocked out");
    } else {
      toast.error("Could not clock out", { description: "Please try again." });
    }
  }

  return (
    <OnTheClockBarView
      session={{ addressLabel }}
      elapsedLabel={elapsedLabel}
      onClockOut={handleClockOut}
      busy={busy}
    />
  );
}
