"use client";

import { useState } from "react";
import { Clock } from "lucide-react";

import { useOnTheClock } from "@/lib/on-the-clock-context";
import ClockInPicker from "@/components/time/clock-in-picker";

// The global one-tap home-screen control (issue #701). For a worker with
// `track_time`, it's the fastest path onto the clock: one tap opens the
// active-Job picker. When already On the clock it reflects that (the persistent
// status bar owns the elapsed time + Clock out), so the home screen never lies
// about the worker's state. Hidden entirely for anyone without `track_time`.
export default function HomeClockControl() {
  const { active, canTrackTime } = useOnTheClock();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!canTrackTime) return null;

  return (
    <section className="mb-6">
      {active ? (
        <div className="flex items-center gap-3 rounded-lg border border-transparent bg-accent-tint px-4 py-3 text-accent-text">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
          <p className="text-sm font-medium">
            You&apos;re on the clock — {active.job?.property_address ?? "your Job"}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          // §2.4: the one solid emerald per view is the page header's primary,
          // so this stays in the emerald family via tint + accent-text — still
          // full-width and large for a fast field tap, just not a solid fill.
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-5 py-4 text-base font-semibold text-accent-text transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
        >
          <Clock size={20} />
          Clock in to a Job
        </button>
      )}

      <ClockInPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </section>
  );
}
