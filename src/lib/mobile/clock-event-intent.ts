// src/lib/mobile/clock-event-intent.ts — the pure mapping from a clock tap to
// the on-disk ClockEventSidecar the queue worker drains, plus the optimistic
// ActiveSession the UI shows at once (#702).
//
// All non-determinism (the device-generated session id + idempotency key, the
// device clock) is INJECTED by the impure provider, so this module is pure and
// fully testable. Keeping the logic here leaves the React provider as thin glue
// (mirroring the photo upload-queue provider, which is likewise untested).

import type { ActiveSession } from "@/lib/on-the-clock-context";
import type { ClockEventSidecar } from "./clock-event-types";

export interface ClockInIntentInput {
  jobId: string;
  /** Device-generated session id (Design A): the row is inserted with this id. */
  sessionId: string;
  /** Device-generated idempotency key. */
  clientCaptureId: string;
  /** Device tap instant — the recorded session start (AC4). ISO-8601 UTC. */
  takenAt: string;
  /** The Job's display details, when the tap knows them, so the optimistic
   *  status bar can name the Job before any server round-trip. */
  job?: ActiveSession["job"];
}

export interface ClockInIntent {
  sidecar: ClockEventSidecar;
  /** The session to show immediately — started at the device tap instant. */
  active: ActiveSession;
}

export function buildClockInIntent(input: ClockInIntentInput): ClockInIntent {
  const sidecar: ClockEventSidecar = {
    client_capture_id: input.clientCaptureId,
    kind: "clock-in",
    job_id: input.jobId,
    session_id: input.sessionId,
    taken_at: input.takenAt,
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
  };
  const active: ActiveSession = {
    sessionId: input.sessionId,
    jobId: input.jobId,
    startedAt: input.takenAt,
    job: input.job ?? null,
  };
  return { sidecar, active };
}

// While a tap is still queued the server's /api/time/active view is stale (it
// has not received the offline tap), so a background refresh must defer to the
// optimistic local state. Once the queue has fully drained the server becomes
// authoritative again — and carries the real Job details the optimistic session
// lacked. This is the rule the provider applies inside refresh(); pulling it out
// keeps the AC-critical branch (AC1 keep-showing, AC8 never-re-show) tested.
export function reconcileActiveSession(args: {
  server: ActiveSession | null;
  optimistic: ActiveSession | null;
  hasPendingTaps: boolean;
}): ActiveSession | null {
  return args.hasPendingTaps ? args.optimistic : args.server;
}

// Replay the queued (un-synced) taps to reconstruct the Open session the device
// believes it is in. Used on cold start and whenever the queue changes, since
// the server's active-session view does not yet include offline taps. Returns
// the session that is still open after the replay, or null if none.
export function deriveActiveFromQueue(
  taps: ClockEventSidecar[],
): ActiveSession | null {
  let active: ActiveSession | null = null;
  const inOrder = [...taps].sort((a, b) =>
    a.taken_at.localeCompare(b.taken_at),
  );
  for (const tap of inOrder) {
    if (tap.kind === "clock-in") {
      active = {
        sessionId: tap.session_id!,
        jobId: tap.job_id,
        startedAt: tap.taken_at,
        job: null, // the queue carries only job_id; the name fills in on sync
      };
    } else {
      active = null; // a clock-out closes the open session
    }
  }
  return active;
}

export interface ClockOutIntentInput {
  clientCaptureId: string;
  takenAt: string;
}

export function buildClockOutIntent(
  active: ActiveSession,
  input: ClockOutIntentInput,
): { sidecar: ClockEventSidecar } {
  const sidecar: ClockEventSidecar = {
    client_capture_id: input.clientCaptureId,
    kind: "clock-out",
    job_id: active.jobId,
    session_id: active.sessionId,
    taken_at: input.takenAt,
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
  };
  return { sidecar };
}
