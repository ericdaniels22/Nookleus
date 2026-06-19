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
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          <p className="text-sm font-medium">
            You&apos;re on the clock — {active.job?.property_address ?? "your Job"}
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-4 text-base font-bold text-white shadow-sm hover:bg-emerald-700 sm:w-auto"
        >
          <Clock size={20} />
          Clock in to a Job
        </button>
      )}

      <ClockInPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </section>
  );
}
