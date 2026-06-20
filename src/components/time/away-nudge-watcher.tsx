"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { toast } from "sonner";

import { useOnTheClock } from "@/lib/on-the-clock-context";
import {
  initialNudgeSurfaceState,
  type ActionableNudge,
  type NudgeSurfaceState,
} from "@/lib/nudge-surface";
import { evaluateNudgeTick } from "@/lib/nudge-watch";

// The self-nudge watcher (issue #702). It is the thin, untested glue around the
// pure, tested nudge engine (nudge-watch → decideNudge + reduceNudgeSurface):
// once a minute, on app foreground, and after recording an away signal, it asks
// the engine whether to surface a reminder for the current Open session, and if
// so renders an in-app toast.
//
// It NEVER clocks anyone out or writes a time (AC6/AC8) — the toast only reminds
// and, optionally, takes the worker to their Open Job's Time tab. The away signal
// is NON-LOCATION (ADR 0019): it is just the instant the app was backgrounded —
// no GPS, geofence, or coordinate is read, stored, or transmitted. Renders
// nothing; mounted once alongside the persistent status bar.

// Thresholds are product-tunable; defaults err toward not nagging. A session
// Open past ~10h prompts "still clocked in?"; being away (app backgrounded)
// ~45min while clocked in prompts "likely left?".
const LONG_OPEN_MS = 10 * 60 * 60 * 1000;
const LONG_AWAY_MS = 45 * 60 * 1000;
const TICK_MS = 60_000;

const NUDGE_COPY: Record<
  ActionableNudge,
  { title: string; description: string }
> = {
  "still-clocked-in": {
    title: "Still clocked in?",
    description:
      "You've been on the clock a long time. Clock out when you're done.",
  },
  "likely-left": {
    title: "Did you leave still clocked in?",
    description:
      "You've been away a while. Clock out if you've left the Job — your time stays running until you do.",
  },
};

export default function AwayNudgeWatcher() {
  const { active, canTrackTime } = useOnTheClock();
  const router = useRouter();

  // The fire-once-per-session throttle state, carried across ticks without
  // driving renders.
  const surfaceRef = useRef<NudgeSurfaceState>(initialNudgeSurfaceState);
  // The last app-backgrounded instant — the NON-LOCATION away signal.
  const lastAwayRef = useRef<number | null>(null);
  // Always-current evaluate(), so the mount-once timer + appState listener call
  // the latest closure (fresh `active` / `router`) without re-subscribing.
  const evaluateRef = useRef<() => void>(() => {});

  const evaluate = useCallback(() => {
    // Off the clock → nothing to nudge about; reset the slate and the away
    // signal so the next session starts fresh.
    if (!canTrackTime || !active) {
      surfaceRef.current = initialNudgeSurfaceState;
      lastAwayRef.current = null;
      return;
    }

    const { state, reminder } = evaluateNudgeTick(surfaceRef.current, {
      openSessionId: active.sessionId,
      openSessionStartedAtMs: new Date(active.startedAt).getTime(),
      nowMs: Date.now(),
      lastAwaySignalMs: lastAwayRef.current,
      thresholds: { longOpenMs: LONG_OPEN_MS, longAwayMs: LONG_AWAY_MS },
    });
    surfaceRef.current = state;
    if (!reminder) return;

    // Capture the Job now; the toast action may fire much later.
    const jobId = active.jobId;
    const copy = NUDGE_COPY[reminder.decision];
    toast(copy.title, {
      description: copy.description,
      // Reminder only: this opens the Open Job's Time tab. It never clocks out
      // or edits a time (AC8) — that stays the worker's explicit action.
      action: {
        label: "View Job",
        onClick: () => router.push(`/jobs/${jobId}?tab=time`),
      },
    });
  }, [canTrackTime, active, router]);

  // Keep the ref pointed at the current evaluate for the mount-once listeners.
  useEffect(() => {
    evaluateRef.current = evaluate;
  }, [evaluate]);

  useEffect(() => {
    let appHandle: { remove: () => Promise<void> } | null = null;

    // Re-check once a minute (minute-granular thresholds don't need finer).
    const id = setInterval(() => evaluateRef.current(), TICK_MS);

    void (async () => {
      appHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          // Foregrounded: re-evaluate now — they may have just returned from a
          // long away stretch while still clocked in.
          evaluateRef.current();
        } else {
          // Backgrounded: stamp the away signal. Just an instant — no location.
          lastAwayRef.current = Date.now();
        }
      });
    })();

    return () => {
      clearInterval(id);
      void appHandle?.remove();
    };
  }, []);

  return null;
}
