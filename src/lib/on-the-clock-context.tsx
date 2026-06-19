"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/lib/auth-context";

// App-wide "On the clock" state (issue #701). One source of truth for whether
// the current worker has an Open Time session, shared by the persistent status
// bar, the home-screen control, and the Job detail Time tab so all three stay
// in sync. The granular `track_time` permission gates clocking in/out; when the
// caller lacks it we never poll and clock-in is a no-op.

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

  const refresh = useCallback(async () => {
    if (!canTrackTime) {
      setActive(null);
      setReady(true);
      return;
    }
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clockIn = useCallback(
    async (jobId: string): Promise<ClockInResult> => {
      if (!canTrackTime) return { ok: false, error: "not permitted" };
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
  }, [canTrackTime, refresh]);

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
