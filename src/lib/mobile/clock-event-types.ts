// src/lib/mobile/clock-event-types.ts — the pure shape + wire mapping for an
// offline-queued clock-in / clock-out (#702).
//
// A ClockEventSidecar is the on-disk record of one clock tap that has not yet
// reached the server. It mirrors the photo CaptureSidecar (capture-types.ts):
// a stable `client_capture_id` idempotency key plus the same sync-state fields
// the queue worker drives. The clock-event queue (clock-event-queue.ts) is a
// sibling of the photo UploadQueueWorker, not a shared engine — clock events
// are only the second consumer of the pattern.
//
// Device time is authoritative (AC4): `taken_at` is the instant the worker
// tapped, on their device, and it becomes the recorded session time. The
// server stamps its own receive time separately as audit-only metadata; it
// never substitutes for `taken_at`.
//
// No location (ADR 0019 / AC7): neither the sidecar nor the wire payload
// carries any lat/long/geofence/region/coordinate field — there is nowhere
// here to put one.

export type ClockEventKind = "clock-in" | "clock-out";

// Same lifecycle as the photo upload state, named for clock sync.
export type SyncState = "pending" | "syncing" | "failed" | "synced";

export interface ClockEventSidecar {
  // Idempotency key. The server enforces (organization_id, client_capture_id)
  // uniqueness, so replaying the same tap yields exactly one session (AC2).
  client_capture_id: string;
  kind: ClockEventKind;
  // The Job being clocked into. For a clock-out this is the Job of the session
  // being closed (context / audit), not a re-target.
  job_id: string;
  // The session this tap commits to. Design A: a clock-in carries the
  // DEVICE-generated session id (the device decides the id at tap time, so a
  // queued clock-out can name it before the clock-in ever syncs); the Route
  // Handler inserts the row with id = this id. A clock-out carries the id of
  // the original Open session it closes — and always closes THAT session even
  // if the worker has since clocked into a different Job (AC: close the
  // original). Null only on a legacy/online sidecar that never device-stamped
  // an id.
  session_id: string | null;
  // Device tap instant — the recorded session time (AC4). ISO-8601 UTC.
  taken_at: string;

  // Sync state (same shape as CaptureSidecar's upload-state fields).
  sync_state: SyncState;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  worker_owner_pid: string | null;
}

// The JSON body the clock-in Route Handler expects. `sessionId` is the
// device-generated id the row is inserted with (Design A) — it lets a queued
// clock-out reference the session before this clock-in has even synced.
export interface ClockInPayload {
  jobId: string;
  sessionId: string;
  clientCaptureId: string;
  takenAt: string;
}

// The JSON body the clock-out Route Handler expects. `sessionId` pins the
// ORIGINAL session this clock-out was tapped for, so a late sync closes that
// session even if the worker has since clocked into a different Job.
export interface ClockOutPayload {
  sessionId: string;
  clientCaptureId: string;
  takenAt: string;
}

export type ClockEventPayload = ClockInPayload | ClockOutPayload;

export function buildClockEventPayload(
  sidecar: ClockEventSidecar,
): ClockEventPayload {
  if (sidecar.kind === "clock-out") {
    return {
      sessionId: sidecar.session_id!,
      clientCaptureId: sidecar.client_capture_id,
      takenAt: sidecar.taken_at,
    };
  }
  return {
    jobId: sidecar.job_id,
    sessionId: sidecar.session_id!,
    clientCaptureId: sidecar.client_capture_id,
    takenAt: sidecar.taken_at,
  };
}
