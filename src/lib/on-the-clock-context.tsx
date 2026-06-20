"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import { useAuth } from "@/lib/auth-context";
import { BackgroundSyncRunner } from "@/lib/mobile/background-sync";
import { NetworkMonitor } from "@/lib/mobile/network-monitor";
import {
  buildClockInIntent,
  buildClockOutIntent,
  deriveActiveFromQueue,
} from "@/lib/mobile/clock-event-intent";
import { ClockEventQueueWorker } from "@/lib/mobile/clock-event-queue";
import { createClockEventPoster } from "@/lib/mobile/clock-event-poster";
import { filesystemClockEventStore } from "@/lib/mobile/clock-event-storage";

// App-wide "On the clock" state (issue #701). One source of truth for whether
// the current worker has an Open Time session, shared by the persistent status
// bar, the home-screen control, and the Job detail Time tab so all three stay
// in sync. The granular `track_time` permission gates clocking in/out; when the
// caller lacks it we never poll and clock-in is a no-op.
//
// Offline resilience (issue #702, native only): on a device, a clock tap is not
// a direct fetch — it is device-stamped, written to an on-disk queue, and shown
// optimistically before it ever leaves the device. A background worker drains
// the queue (oldest tap first) once the network is confirmed online, and the
// server is idempotent on a client-generated capture id, so a retry / app
// restart / duplicated drain all resolve to exactly one server session. While
// taps are still queued the device's own queue — not the (stale) server view —
// is the source of truth for the Open session. On the web there is no queue;
// clock-in/out stay direct fetches.

export interface ActiveSession {
  sessionId: string;
  jobId: string;
  startedAt: string;
  job: { property_address: string; job_number: string } | null;
}

/** Mirrors the POST /api/time/clock-in response so callers can react to a
 *  Job switch (auto-closed prior session) or an idempotent re-clock-in. */
export interface ClockInResult {
  ok: boolean;
  sessionId?: string;
  jobId?: string;
  switched?: boolean;
  closedJobId?: string;
  alreadyOpen?: boolean;
  error?: string;
}

interface OnTheClockValue {
  active: ActiveSession | null;
  /** True once the initial /api/time/active fetch has resolved. */
  ready: boolean;
  canTrackTime: boolean;
  clockIn: (jobId: string) => Promise<ClockInResult>;
  clockOut: () => Promise<{ ok: boolean }>;
  refresh: () => Promise<void>;
}

const OnTheClockContext = createContext<OnTheClockValue | null>(null);

export function OnTheClockProvider({ children }: { children: ReactNode }) {
  const { user, hasPermission } = useAuth();
  const canTrackTime = Boolean(user) && hasPermission("track_time");

  const [active, setActive] = useState<ActiveSession | null>(null);
  const [ready, setReady] = useState(false);

  // The native offline queue worker (null on web). Created once on mount.
  const workerRef = useRef<ClockEventQueueWorker | null>(null);
  const networkRef = useRef<NetworkMonitor | null>(null);
  const bgSyncRef = useRef<BackgroundSyncRunner | null>(null);
  // The worker's onChange (mount-once) calls the latest refresh through this ref
  // so it never closes over a stale copy or forces the setup effect to re-run.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    if (!canTrackTime) {
      setActive(null);
      setReady(true);
      return;
    }
    // Native: while offline taps are still queued, the device's own queue is the
    // truth — the server has not received them yet (AC1: a queued clock-in keeps
    // showing; AC8: a queued clock-out stays closed). Replay the queue rather
    // than trust /api/time/active.
    const worker = workerRef.current;
    if (worker && worker.list().length > 0) {
      setActive(deriveActiveFromQueue(worker.list()));
      setReady(true);
      return;
    }
    // Web, or a native device whose queue has fully drained → the server is
    // authoritative (and carries the real Job details the optimistic session
    // lacked).
    try {
      const res = await fetch("/api/time/active");
      if (!res.ok) {
        setActive(null);
        return;
      }
      const data = (await res.json()) as { active: ActiveSession | null };
      setActive(data.active ?? null);
    } catch {
      // Network hiccup — keep the last known state rather than flicker.
    } finally {
      setReady(true);
    }
  }, [canTrackTime]);

  // Keep the ref pointed at the current refresh for the worker's onChange.
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Native-only: stand up the offline clock-event queue and drain it on the
  // signals that mean "we might be online now" — network regained, app brought
  // to the foreground, or about to be suspended (a finite background task). The
  // worker writes the active session whenever the queue changes; an emptied
  // queue hands authority back to the server via refresh().
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let appStateHandle: { remove: () => Promise<void> } | null = null;

    (async () => {
      const onChange = () => {
        if (cancelled || !workerRef.current) return;
        const taps = workerRef.current.list();
        if (taps.length > 0) {
          // Un-synced taps imply the Open session (AC1/AC8).
          setActive(deriveActiveFromQueue(taps));
        } else {
          // Drained — let the server become authoritative again.
          void refreshRef.current?.();
        }
      };

      const worker = new ClockEventQueueWorker({
        store: filesystemClockEventStore,
        post: createClockEventPoster(),
        onChange,
      });
      workerRef.current = worker;

      // Recover any taps a prior run left mid-flight, then reflect them in the UI.
      await worker.scanAll();
      if (cancelled) return;

      const network = new NetworkMonitor();
      await network.start((online) => {
        worker.setOnline(online);
        if (online) void worker.drain();
      });
      networkRef.current = network;

      const bgSync = new BackgroundSyncRunner();
      await bgSync.start(() => worker.drain());
      bgSyncRef.current = bgSync;

      appStateHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void worker.drain();
      });
    })();

    return () => {
      cancelled = true;
      networkRef.current?.stop();
      bgSyncRef.current?.stop();
      appStateHandle?.remove();
      workerRef.current = null;
    };
  }, []);

  const clockIn = useCallback(
    async (jobId: string): Promise<ClockInResult> => {
      if (!canTrackTime) return { ok: false, error: "not permitted" };

      // Native offline-resilient path: stamp the tap on the device and enqueue
      // it. The session id is device-generated (Design A) so a later clock-out
      // can name this session before the clock-in has even synced.
      const worker = workerRef.current;
      if (worker) {
        const sessionId = crypto.randomUUID();
        const clientCaptureId = crypto.randomUUID();
        const takenAt = new Date().toISOString();
        const { sidecar, active: optimistic } = buildClockInIntent({
          jobId,
          sessionId,
          clientCaptureId,
          takenAt,
        });
        try {
          await filesystemClockEventStore.put(sidecar);
        } catch {
          return { ok: false, error: "Could not clock in" };
        }
        setActive(optimistic); // show it immediately, before any round-trip (AC1)
        await worker.scanAll(); // load the new tap into the worker
        void worker.drain(); // best-effort send; offline → it stays queued
        return { ok: true, sessionId, jobId };
      }

      // Web path: a direct fetch (no offline queue).
      try {
        const res = await fetch("/api/time/clock-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<ClockInResult>;
        if (!res.ok) {
          return { ok: false, error: data.error ?? "Could not clock in" };
        }
        await refresh();
        return { ok: true, ...data };
      } catch {
        return { ok: false, error: "Could not clock in" };
      }
    },
    [canTrackTime, refresh],
  );

  const clockOut = useCallback(async (): Promise<{ ok: boolean }> => {
    if (!canTrackTime) return { ok: false };

    // Native offline-resilient path: enqueue a clock-out for the Open session,
    // pinned to its id so a late sync closes THAT session even if the worker has
    // since clocked into a different Job (AC8: never re-target).
    const worker = workerRef.current;
    if (worker) {
      // The open session is whatever the queue still implies, falling back to
      // the last known active (a session that synced before going offline).
      const open = deriveActiveFromQueue(worker.list()) ?? active;
      if (!open) return { ok: false };
      const clientCaptureId = crypto.randomUUID();
      const takenAt = new Date().toISOString();
      const { sidecar } = buildClockOutIntent(open, { clientCaptureId, takenAt });
      try {
        await filesystemClockEventStore.put(sidecar);
      } catch {
        return { ok: false };
      }
      setActive(null); // optimistically clear; stays cleared while queued (AC8)
      await worker.scanAll();
      void worker.drain();
      return { ok: true };
    }

    // Web path: a direct fetch.
    try {
      const res = await fetch("/api/time/clock-out", { method: "POST" });
      if (!res.ok) return { ok: false };
      // Optimistically clear, then reconcile with the server.
      setActive(null);
      await refresh();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }, [canTrackTime, active, refresh]);

  return (
    <OnTheClockContext.Provider
      value={{ active, ready, canTrackTime, clockIn, clockOut, refresh }}
    >
      {children}
    </OnTheClockContext.Provider>
  );
}

export function useOnTheClock(): OnTheClockValue {
  const ctx = useContext(OnTheClockContext);
  if (!ctx) {
    throw new Error("useOnTheClock must be used within an OnTheClockProvider");
  }
  return ctx;
}
