import { describe, it, expect } from "vitest";
import {
  buildClockInIntent,
  buildClockOutIntent,
  deriveActiveFromQueue,
  reconcileActiveSession,
} from "./clock-event-intent";
import type { ActiveSession } from "@/lib/on-the-clock-context";
import type { ClockEventSidecar } from "./clock-event-types";

// A queued tap, with the sync-state bookkeeping defaulted — these tests only
// care about kind / ids / taken_at, the fields that decide the open session.
function tap(over: Partial<ClockEventSidecar>): ClockEventSidecar {
  return {
    client_capture_id: "cap",
    kind: "clock-in",
    job_id: "job-1",
    session_id: "sess-1",
    taken_at: "2026-06-19T08:00:00.000Z",
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
    ...over,
  };
}

// #702 — the pure mapping from a clock tap to (a) the on-disk ClockEventSidecar
// the queue worker drains and (b) the optimistic ActiveSession the UI shows
// immediately. It is I/O-free: the impure provider generates the ids and reads
// the device clock, then hands those values in, so this logic is deterministic
// and fully testable. Device time is authoritative (AC4); no location anywhere
// (ADR 0019 / AC7).

describe("buildClockInIntent", () => {
  it("builds a pending clock-in sidecar that carries the device session id, capture id, Job and tap instant", () => {
    const { sidecar } = buildClockInIntent({
      jobId: "job-1",
      sessionId: "sess-dev-1",
      clientCaptureId: "cap-1",
      takenAt: "2026-06-19T08:00:00.000Z",
    });

    expect(sidecar).toEqual({
      client_capture_id: "cap-1",
      kind: "clock-in",
      job_id: "job-1",
      session_id: "sess-dev-1",
      taken_at: "2026-06-19T08:00:00.000Z",
      sync_state: "pending",
      retry_count: 0,
      last_error: null,
      last_attempt_at: null,
      worker_owner_pid: null,
    });
  });

  it("returns an optimistic ActiveSession the UI shows at once — started at the device tap instant, on the device session id (AC4)", () => {
    const { active } = buildClockInIntent({
      jobId: "job-1",
      sessionId: "sess-dev-1",
      clientCaptureId: "cap-1",
      takenAt: "2026-06-19T08:00:00.000Z",
    });

    expect(active).toEqual<ActiveSession>({
      sessionId: "sess-dev-1",
      jobId: "job-1",
      startedAt: "2026-06-19T08:00:00.000Z",
      job: null,
    });
  });

  it("carries the Job's display details into the optimistic session when the tap knows them (so the offline status bar names the Job)", () => {
    const job = { property_address: "12 Oak St", job_number: "J-100" };
    const { active } = buildClockInIntent({
      jobId: "job-1",
      sessionId: "sess-dev-1",
      clientCaptureId: "cap-1",
      takenAt: "2026-06-19T08:00:00.000Z",
      job,
    });

    expect(active.job).toEqual(job);
  });
});

// On a cold start the server's /api/time/active view does not include taps that
// were made offline and are still queued, so the provider reconstructs the Open
// session by replaying its own queue. This is what makes an offline clock-in
// survive a restart (AC1) and an offline clock-out stay closed (AC8).
describe("deriveActiveFromQueue", () => {
  it("returns no session when the queue is empty", () => {
    expect(deriveActiveFromQueue([])).toBeNull();
  });

  it("shows the Open session for a lone queued clock-in (an offline clock-in that survived a restart) — on its session id and device tap instant, Job name pending sync (AC1)", () => {
    const active = deriveActiveFromQueue([
      tap({
        kind: "clock-in",
        session_id: "sess-dev-1",
        job_id: "job-1",
        taken_at: "2026-06-19T08:00:00.000Z",
      }),
    ]);

    expect(active).toEqual<ActiveSession>({
      sessionId: "sess-dev-1",
      jobId: "job-1",
      startedAt: "2026-06-19T08:00:00.000Z",
      job: null,
    });
  });

  it("nets to closed when a queued clock-in is followed by its clock-out", () => {
    const active = deriveActiveFromQueue([
      tap({
        kind: "clock-in",
        client_capture_id: "in",
        session_id: "sess-dev-1",
        taken_at: "2026-06-19T08:00:00.000Z",
      }),
      tap({
        kind: "clock-out",
        client_capture_id: "out",
        session_id: "sess-dev-1",
        taken_at: "2026-06-19T17:00:00.000Z",
      }),
    ]);

    expect(active).toBeNull();
  });

  it("stays closed for a lone queued clock-out — its clock-in already synced and left the disk, so it must not re-show the Open session (AC8)", () => {
    const active = deriveActiveFromQueue([
      tap({
        kind: "clock-out",
        client_capture_id: "out",
        session_id: "sess-synced-1",
        taken_at: "2026-06-19T17:00:00.000Z",
      }),
    ]);

    expect(active).toBeNull();
  });

  it("replays in device-time order, not array order — an out-of-order queue (clock-out listed before its earlier clock-in) still nets to closed", () => {
    const active = deriveActiveFromQueue([
      tap({
        kind: "clock-out",
        client_capture_id: "out",
        session_id: "sess-dev-1",
        taken_at: "2026-06-19T17:00:00.000Z",
      }),
      tap({
        kind: "clock-in",
        client_capture_id: "in",
        session_id: "sess-dev-1",
        taken_at: "2026-06-19T08:00:00.000Z",
      }),
    ]);

    expect(active).toBeNull();
  });
});

describe("buildClockOutIntent", () => {
  const openSession: ActiveSession = {
    sessionId: "sess-open-1",
    jobId: "job-1",
    startedAt: "2026-06-19T08:00:00.000Z",
    job: { property_address: "12 Oak St", job_number: "J-100" },
  };

  it("builds a pending clock-out sidecar pinned to the open session's id, stamped with the device tap instant", () => {
    const { sidecar } = buildClockOutIntent(openSession, {
      clientCaptureId: "cap-out-1",
      takenAt: "2026-06-19T17:30:00.000Z",
    });

    expect(sidecar).toEqual({
      client_capture_id: "cap-out-1",
      kind: "clock-out",
      // The original session this clock-out closes — even if the worker later
      // clocks into a different Job, this id is what drains (AC8: the Open
      // session, never a re-target).
      job_id: "job-1",
      session_id: "sess-open-1",
      taken_at: "2026-06-19T17:30:00.000Z",
      sync_state: "pending",
      retry_count: 0,
      last_error: null,
      last_attempt_at: null,
      worker_owner_pid: null,
    });
  });
});

// While a tap is still queued the server's /api/time/active view is stale, so a
// background refresh must NOT overwrite the optimistic local state. This guards
// AC1 (an offline clock-in keeps showing) and AC8 (an offline clock-out is not
// re-shown as Open just because the server hasn't received it yet).
describe("reconcileActiveSession", () => {
  const optimistic: ActiveSession = {
    sessionId: "sess-dev-1",
    jobId: "job-1",
    startedAt: "2026-06-19T08:00:00.000Z",
    job: null,
  };

  it("keeps the optimistic clock-in while taps are still queued, even though the server has not caught up", () => {
    const next = reconcileActiveSession({
      server: null,
      optimistic,
      hasPendingTaps: true,
    });
    expect(next).toEqual(optimistic);
  });

  it("keeps an offline clock-out's cleared state while its tap is queued — never re-shows the Open session (AC8)", () => {
    const serverStillOpen: ActiveSession = {
      sessionId: "sess-dev-1",
      jobId: "job-1",
      startedAt: "2026-06-19T08:00:00.000Z",
      job: null,
    };
    const next = reconcileActiveSession({
      server: serverStillOpen,
      optimistic: null, // the worker tapped clock-out; we cleared it
      hasPendingTaps: true,
    });
    expect(next).toBeNull();
  });

  it("trusts the server once the queue has fully drained (authoritative, with real Job details)", () => {
    const serverActive: ActiveSession = {
      sessionId: "sess-real-1",
      jobId: "job-1",
      startedAt: "2026-06-19T08:00:00.000Z",
      job: { property_address: "12 Oak St", job_number: "J-100" },
    };
    const next = reconcileActiveSession({
      server: serverActive,
      optimistic,
      hasPendingTaps: false,
    });
    expect(next).toEqual(serverActive);
  });
});
