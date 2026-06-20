// src/lib/mobile/clock-event-queue.ts — the offline queue for clock-in / out
// taps (#702). A SIBLING of the photo UploadQueueWorker (upload-queue.ts), not a
// shared engine: clock events are only the second consumer of the pattern, so it
// is copied, not extracted (extract on the third consumer).
//
// What it does: each tap is written to disk as a ClockEventSidecar before it
// leaves the device. The worker drains the queue once the network is confirmed
// online, POSTing each tap to its Route Handler. The taps are device-stamped
// (taken_at) and idempotent server-side (client_capture_id), so a retry, an app
// restart mid-sync, or a duplicated drain all resolve to one server session
// (ADR 0023; migration-663). Unlike photos — which are independent and upload in
// parallel — clock events are causally ordered (a clock-out must reach the
// server after its clock-in), so the worker drains SERIALLY in taken_at order.

import {
  buildClockEventPayload,
  type ClockEventKind,
  type ClockEventPayload,
  type ClockEventSidecar,
  type SyncState,
} from "./clock-event-types";

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 30000] as const;

// The delay before the (retryCount+1)-th attempt, or null once the three
// retries are spent (the tap is parked in 'failed' for a manual retry).
export function computeClockBackoffMs(retryCount: number): number | null {
  if (retryCount >= MAX_RETRIES) return null;
  return BACKOFF_MS[retryCount];
}

// A sidecar is an orphaned claim if it is 'syncing' but the owning worker is not
// us — its process died mid-flight (an app kill / crash during sync). On scan we
// reclaim it to 'pending' so it drains again; the server idempotency key makes a
// possible double-send harmless.
export function isStaleSyncingClaim(
  s: Pick<ClockEventSidecar, "sync_state" | "worker_owner_pid">,
  currentPid: string,
): boolean {
  return s.sync_state === "syncing" && s.worker_owner_pid !== currentPid;
}

const VALID_SYNC_STATES: ReadonlySet<SyncState> = new Set<SyncState>([
  "pending",
  "syncing",
  "failed",
  "synced",
]);

// A sidecar with an unrecognized sync_state (corrupt, or from another build) is
// recovered to 'pending' on scan rather than trusted or dropped.
export function needsClockSyncStateBackfill(
  s: Pick<ClockEventSidecar, "sync_state">,
): boolean {
  return !VALID_SYNC_STATES.has(s.sync_state as SyncState);
}

// ---------------------------------------------------------------------------
// The worker. I/O is injected (store + post) so the orchestration is testable
// without the native Filesystem plugin; clock-event-storage.ts / a fetch wrapper
// supply the real implementations.
// ---------------------------------------------------------------------------

export interface ClockEventStore {
  /** Every queued sidecar currently on disk. */
  list(): Promise<ClockEventSidecar[]>;
  /** Create or overwrite a sidecar (keyed on client_capture_id). */
  put(sidecar: ClockEventSidecar): Promise<void>;
  /** Delete a sidecar once its tap has reached the server. */
  remove(clientCaptureId: string): Promise<void>;
}

export interface PostResult {
  /** True for any 2xx — including an idempotent replay the server no-ops. */
  ok: boolean;
  status: number;
  /** The authoritative session id a clock-in resolved, when the route returns it. */
  sessionId?: string | null;
  error?: string;
}

export type PostClockEvent = (
  kind: ClockEventKind,
  payload: ClockEventPayload,
) => Promise<PostResult>;

export interface ClockQueueDeps {
  store: ClockEventStore;
  post: PostClockEvent;
  onChange?: () => void;
}

export interface ClockQueueCounts {
  pending: number;
  syncing: number;
  failed: number;
  synced: number;
}

export class ClockEventQueueWorker {
  private readonly thisPid: string;
  private readonly deps: ClockQueueDeps;
  private items = new Map<string, ClockEventSidecar>();
  // Pessimistic default: stay paused until the network is confirmed online, so
  // the worker never burns retry budget against a known-offline connection.
  private isOnline = false;

  constructor(deps: ClockQueueDeps) {
    this.deps = deps;
    this.thisPid = crypto.randomUUID();
  }

  setOnline(online: boolean): void {
    this.isOnline = online;
  }

  /**
   * Re-read disk into memory, recovering taps a prior run left in a bad state.
   * A tap orphaned 'syncing' by a dead process (its pid is not ours), or one
   * whose sync_state is unrecognized (corrupt / a foreign build's shape), is
   * reset to 'pending' — and persisted — so it drains again. Re-sending is safe
   * because the server is idempotent on client_capture_id (#702).
   */
  async scanAll(): Promise<void> {
    this.items.clear();
    for (const s of await this.deps.store.list()) {
      const recovered =
        isStaleSyncingClaim(s, this.thisPid) || needsClockSyncStateBackfill(s)
          ? await this.recover(s)
          : s;
      this.items.set(recovered.client_capture_id, recovered);
    }
    this.deps.onChange?.();
  }

  private async recover(s: ClockEventSidecar): Promise<ClockEventSidecar> {
    const reset: ClockEventSidecar = {
      ...s,
      sync_state: "pending",
      worker_owner_pid: null,
    };
    await this.deps.store.put(reset);
    return reset;
  }

  /** All queued taps, oldest tap first — the order they must reach the server. */
  list(): ClockEventSidecar[] {
    return [...this.items.values()].sort((a, b) =>
      a.taken_at.localeCompare(b.taken_at),
    );
  }

  /** Per-state tally of the queued taps. The provider derives "are there still
   *  un-synced taps?" from this to know whether to trust its optimistic session
   *  or the (possibly stale) server view. Synced taps are removed from disk on
   *  success, so 'synced' is effectively always zero here. */
  counts(): ClockQueueCounts {
    const counts: ClockQueueCounts = {
      pending: 0,
      syncing: 0,
      failed: 0,
      synced: 0,
    };
    for (const s of this.items.values()) counts[s.sync_state] += 1;
    return counts;
  }

  // Strict FIFO by tap time. Clock events are causally ordered (a clock-out must
  // reach the server after its clock-in), so the worker processes the oldest tap
  // and stops the moment that head cannot proceed — not yet due, failed, or it
  // fails this pass — rather than skipping ahead the way the photo queue does.
  async drain(): Promise<void> {
    if (!this.isOnline) return;
    while (true) {
      const head = this.list()[0];
      if (!head) break;
      if (head.sync_state !== "pending") break; // failed/syncing head blocks
      if (!this.isDue(head)) break; // backoff not elapsed yet
      const ok = await this.processOne(head);
      if (!ok) break; // do not skip a tap that just failed
    }
  }

  private isDue(s: ClockEventSidecar): boolean {
    if (s.last_attempt_at == null) return true;
    const backoff = computeClockBackoffMs(s.retry_count - 1) ?? 0;
    return Date.now() >= new Date(s.last_attempt_at).getTime() + backoff;
  }

  private async processOne(s: ClockEventSidecar): Promise<boolean> {
    const claimed: ClockEventSidecar = {
      ...s,
      sync_state: "syncing",
      worker_owner_pid: this.thisPid,
      last_attempt_at: new Date().toISOString(),
    };
    await this.deps.store.put(claimed);
    this.items.set(s.client_capture_id, claimed);
    this.deps.onChange?.();

    const result = await this.deps.post(s.kind, buildClockEventPayload(s));
    if (result.ok) {
      // 2xx — the tap (or an idempotent replay of it) reached the server.
      await this.deps.store.remove(s.client_capture_id);
      this.items.delete(s.client_capture_id);
      this.deps.onChange?.();
      return true;
    }

    // Failure — count the attempt and keep the tap on disk. It returns to
    // 'pending' (retriable, once the backoff elapses) until the retry budget is
    // spent, then parks in 'failed' for a manual retry. A tap is never dropped.
    const retryCount = claimed.retry_count + 1;
    const exhausted = retryCount >= MAX_RETRIES;
    const failed: ClockEventSidecar = {
      ...claimed,
      sync_state: exhausted ? "failed" : "pending",
      retry_count: retryCount,
      last_error: result.error ?? `post failed (${result.status})`,
    };
    await this.deps.store.put(failed);
    this.items.set(s.client_capture_id, failed);
    this.deps.onChange?.();
    return false;
  }
}
