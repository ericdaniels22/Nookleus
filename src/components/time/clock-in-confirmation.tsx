"use client";

import { useState } from "react";
import { Clock, X } from "lucide-react";
import { toast } from "sonner";

import { useOnTheClock } from "@/lib/on-the-clock-context";

// The loud, full-screen confirmation shown before a session starts (issue
// #701, AC2). It names the Job in large type so a wrong-Job pick is caught
// instantly, then commits the clock-in on confirm. Owning the commit here keeps
// the auto-close-on-switch message (AC4) in one place for both entry points
// (the home-screen picker and the Job detail Time tab).

export interface ClockInTarget {
  id: string;
  property_address: string;
  job_number?: string;
}

export default function ClockInConfirmation({
  job,
  onClose,
}: {
  job: ClockInTarget;
  /** Called when the overlay dismisses; `started` is true once a session began. */
  onClose: (started: boolean) => void;
}) {
  const { clockIn } = useOnTheClock();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const result = await clockIn(job.id);
    setBusy(false);

    if (!result.ok) {
      toast.error("Could not clock in", {
        description: result.error ?? "Please try again.",
      });
      return;
    }
    if (result.alreadyOpen) {
      toast(`Already clocked in to ${job.property_address}`);
    } else if (result.switched) {
      toast.success(`Clocked in to ${job.property_address}`, {
        description: "Your previous session was clocked out.",
      });
    } else {
      toast.success(`Clocked in to ${job.property_address}`);
    }
    onClose(true);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 bg-emerald-600 px-6 text-center text-white">
      <button
        type="button"
        onClick={() => onClose(false)}
        aria-label="Cancel"
        className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] rounded-full p-2 text-white/80 hover:bg-white/15 hover:text-white"
      >
        <X size={24} />
      </button>

      <div className="flex flex-col items-center gap-3">
        <span className="flex size-16 items-center justify-center rounded-full bg-white/15">
          <Clock size={32} />
        </span>
        <p className="text-sm font-medium uppercase tracking-wide text-white/80">
          Clock in to
        </p>
        <h1 className="max-w-md text-4xl font-extrabold leading-tight">
          {job.property_address}
        </h1>
        {job.job_number && (
          <p className="text-base text-white/80">Job {job.job_number}</p>
        )}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="w-full rounded-xl bg-white px-6 py-4 text-lg font-bold text-emerald-700 shadow-lg hover:bg-white/90 disabled:opacity-70"
        >
          {busy ? "Starting…" : "Clock in"}
        </button>
        <button
          type="button"
          onClick={() => onClose(false)}
          disabled={busy}
          className="w-full rounded-xl px-6 py-3 text-base font-semibold text-white/90 hover:bg-white/10 disabled:opacity-70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
