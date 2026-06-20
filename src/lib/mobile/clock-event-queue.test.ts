import { describe, it, expect } from "vitest";
import {
  computeClockBackoffMs,
  isStaleSyncingClaim,
  needsClockSyncStateBackfill,
  ClockEventQueueWorker,
  type ClockEventStore,
  type PostClockEvent,
} from "./clock-event-queue";
import type { ClockEventSidecar } from "./clock-event-types";

// ----- test doubles -------------------------------------------------------

function sidecar(over: Partial<ClockEventSidecar> = {}): ClockEventSidecar {
  return {
    client_capture_id: "cap-1",
    kind: "clock-in",
    job_id: "job-1",
    // Design A: a clock-in sidecar carries the device-generated session id.
    session_id: "sess-default",
    taken_at: "2026-06-19T12:00:00.000Z",
    sync_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
    ...over,
  };
}

// An in-memory ClockEventStore. Each call clones so the worker can never mutate
// our copy except through put/remove — the same isolation a disk store gives.
function memStore(initial: ClockEventSidecar[] = []) {
  const rows = new Map<string, ClockEventSidecar>(
    initial.map((s) => [s.client_capture_id, structuredClone(s)]),
  );
  const store: ClockEventStore = {
    async list() {
      return [...rows.values()].map((s) => structuredClone(s));
    },
    async put(s) {
      rows.set(s.client_capture_id, structuredClone(s));
    },
    async remove(id) {
      rows.delete(id);
    },
  };
  return { store, rows };
}

// A recording poster. `impl` decides each response; default is 2xx success.
function recordingPost(
  impl?: (kind: string, payload: unknown, callNo: number) =>
    Awaited<ReturnType<PostClockEvent>>,
) {
  const calls: { kind: string; payload: any }[] = [];
  const post: PostClockEvent = async (kind, payload) => {
    calls.push({ kind, payload });
    return impl ? impl(kind, payload, calls.length) : { ok: true, status: 200 };
  };
  return { post, calls };
}

// #702 — the offline clock-event queue mirrors the photo upload queue's retry
// schedule: three attempts with growing backoff, then give up (state = failed).
describe("computeClockBackoffMs", () => {
  it("schedules 1s / 5s / 30s for the first three retries, then stops", () => {
    expect(computeClockBackoffMs(0)).toBe(1000);
    expect(computeClockBackoffMs(1)).toBe(5000);
    expect(computeClockBackoffMs(2)).toBe(30000);
    expect(computeClockBackoffMs(3)).toBeNull();
    expect(computeClockBackoffMs(99)).toBeNull();
  });
});

// Restart recovery: a sidecar left 'syncing' by a process that has since died
// (its pid is not ours) is an orphaned claim we must reclaim on scan.
describe("isStaleSyncingClaim", () => {
  it("true when state=syncing and the owner pid is not ours", () => {
    expect(
      isStaleSyncingClaim(
        { sync_state: "syncing", worker_owner_pid: "dead-pid" },
        "our-pid",
      ),
    ).toBe(true);
  });
  it("false when state=syncing and the owner pid is ours (in flight, not orphaned)", () => {
    expect(
      isStaleSyncingClaim(
        { sync_state: "syncing", worker_owner_pid: "our-pid" },
        "our-pid",
      ),
    ).toBe(false);
  });
  it("false for any non-syncing state regardless of owner", () => {
    expect(
      isStaleSyncingClaim(
        { sync_state: "pending", worker_owner_pid: "dead-pid" },
        "our-pid",
      ),
    ).toBe(false);
  });
});

// A sidecar whose sync_state is not one of the known states (corrupt on disk, or
// a shape from a future/older build) is recovered to 'pending' on scan rather
// than being trusted or dropped.
describe("needsClockSyncStateBackfill", () => {
  it.each(["pending", "syncing", "failed", "synced"] as const)(
    "false for the known state %s",
    (state) => {
      expect(needsClockSyncStateBackfill({ sync_state: state })).toBe(false);
    },
  );
  it("true for an unknown, missing, null, or empty sync_state", () => {
    expect(needsClockSyncStateBackfill({ sync_state: "weird" as never })).toBe(true);
    expect(needsClockSyncStateBackfill({} as never)).toBe(true);
    expect(needsClockSyncStateBackfill({ sync_state: null as never })).toBe(true);
    expect(needsClockSyncStateBackfill({ sync_state: "" as never })).toBe(true);
  });
});

describe("ClockEventQueueWorker", () => {
  it("posts nothing while offline (pessimistic — paused until the network is confirmed)", async () => {
    const { store } = memStore([sidecar()]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    await worker.drain(); // never went online

    expect(calls).toHaveLength(0);
  });

  it("once online, posts a pending clock-in's payload and drops it on success", async () => {
    const { store, rows } = memStore([
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        job_id: "job-7",
        session_id: "sess-7",
        taken_at: "2026-06-19T08:00:00.000Z",
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("clock-in");
    expect(calls[0].payload).toEqual({
      jobId: "job-7",
      sessionId: "sess-7",
      clientCaptureId: "cap-in",
      takenAt: "2026-06-19T08:00:00.000Z",
    });
    expect(rows.size).toBe(0); // removed from disk on success
  });

  it("drains strictly in tap order — a clock-in reaches the server before its later clock-out", async () => {
    // Causal order: the clock-out at 17:00 must not be sent before the clock-in
    // at 08:00, even if disk hands them back in any order.
    const { store } = memStore([
      sidecar({
        kind: "clock-out",
        client_capture_id: "cap-out",
        session_id: "sess-1",
        taken_at: "2026-06-19T17:00:00.000Z",
      }),
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        taken_at: "2026-06-19T08:00:00.000Z",
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    expect(calls.map((c) => c.kind)).toEqual(["clock-in", "clock-out"]);
  });

  it("a failed post leaves the tap queued for retry — counts the attempt and records the error, never drops it", async () => {
    const { store, rows } = memStore([
      sidecar({ kind: "clock-in", client_capture_id: "cap-in" }),
    ]);
    const { post, calls } = recordingPost(() => ({
      ok: false,
      status: 500,
      error: "server boom",
    }));
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    // Attempted once; the backoff then blocks an immediate retry this pass.
    expect(calls).toHaveLength(1);
    expect(rows.size).toBe(1); // still on disk — a tap is never lost on failure

    const [tap] = worker.list();
    expect(tap.sync_state).toBe("pending"); // retriable, not stuck mid-flight
    expect(tap.retry_count).toBe(1);
    expect(tap.last_error).toBe("server boom");
  });

  it("parks a tap in 'failed' once the retry budget is spent, and stops attempting it", async () => {
    // Two attempts already behind it; this next failure exhausts the budget.
    const { store } = memStore([
      sidecar({ kind: "clock-in", client_capture_id: "cap-in", retry_count: 2 }),
    ]);
    const { post, calls } = recordingPost(() => ({
      ok: false,
      status: 503,
      error: "still down",
    }));
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();
    await worker.drain(); // a later pass must not re-attempt a given-up head

    expect(calls).toHaveLength(1); // one final attempt, then parked
    const [tap] = worker.list();
    expect(tap.sync_state).toBe("failed");
    expect(tap.retry_count).toBe(3);
  });

  it("respects backoff — a head attempted moments ago is held until its delay elapses", async () => {
    const { store } = memStore([
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        retry_count: 1, // next delay is BACKOFF_MS[0] = 1000ms
        last_attempt_at: new Date(Date.now() - 200).toISOString(), // only 200ms ago
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(0); // backoff not elapsed → nothing sent this pass
  });

  it("retries once the backoff has elapsed", async () => {
    const { store, rows } = memStore([
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        retry_count: 1, // 1000ms delay
        last_attempt_at: new Date(Date.now() - 5000).toISOString(), // well past it
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(1); // delay elapsed → attempted, and succeeds
    expect(rows.size).toBe(0);
  });

  it("on restart, reclaims a tap orphaned 'syncing' by a dead process and drains it again", async () => {
    const { store, rows } = memStore([
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        sync_state: "syncing",
        worker_owner_pid: "dead-pid", // a previous process killed mid-sync
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll(); // recovery happens on scan
    expect(worker.list()[0].sync_state).toBe("pending"); // reclaimed

    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(1); // re-sent; server idempotency makes it safe
    expect(rows.size).toBe(0);
  });

  it("on restart, backfills a tap with a corrupt sync_state to 'pending'", async () => {
    const { store, rows } = memStore([
      sidecar({
        kind: "clock-in",
        client_capture_id: "cap-in",
        sync_state: "weird" as never, // corrupt on disk / a foreign build's shape
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    expect(worker.list()[0].sync_state).toBe("pending"); // recovered, not trusted

    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(1);
    expect(rows.size).toBe(0);
  });

  it("counts the queued taps by sync state, so the provider knows when the queue is still unsynced", async () => {
    const { store } = memStore([
      sidecar({ client_capture_id: "a", sync_state: "pending" }),
      sidecar({ client_capture_id: "b", sync_state: "pending" }),
      sidecar({ client_capture_id: "c", sync_state: "failed" }),
    ]);
    const { post } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll(); // stays offline → nothing drains, states preserved

    expect(worker.counts()).toEqual({
      pending: 2,
      syncing: 0,
      failed: 1,
      synced: 0,
    });
  });

  it("posts a clock-out's payload — the original session id, the capture id, and the device time", async () => {
    const { store, rows } = memStore([
      sidecar({
        kind: "clock-out",
        client_capture_id: "cap-out",
        session_id: "sess-42",
        taken_at: "2026-06-19T17:00:00.000Z",
      }),
    ]);
    const { post, calls } = recordingPost();
    const worker = new ClockEventQueueWorker({ store, post });

    await worker.scanAll();
    worker.setOnline(true);
    await worker.drain();

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("clock-out");
    expect(calls[0].payload).toEqual({
      sessionId: "sess-42",
      clientCaptureId: "cap-out",
      takenAt: "2026-06-19T17:00:00.000Z",
    });
    expect(rows.size).toBe(0);
  });
});
