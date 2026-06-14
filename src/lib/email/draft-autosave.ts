// Draft autosave scheduler (deep module B, issue #641 / PRD #634).
//
// Owns the autosave DECISION and the draft-id lifecycle for the compose window,
// kept entirely free of React so it can be unit-tested with fake timers and a
// mocked save call. The React layer is a thin shell that:
//   • establishes a baseline on open/resume via reset(),
//   • feeds every compose snapshot into notifyChange() as the user edits,
//   • flush()es on close and cancel()s on send,
//   • renders getStatus() ("Saving…/Saved") and reads getDraftId().
//
// Responsibilities (mirrors the estimate-builder autosave split, where the pure
// planUnmountFlush owns the decision and the hook is transport):
//   • debounce edits into a single save (coalescing),
//   • track a dirty flag relative to the last-saved/opened baseline so an
//     untouched (or reverted) compose never autosaves — "no save when clean",
//   • manage the create-then-update transition: the first save sends no draftId,
//     captures the returned id, and every later save reuses it (no duplicate
//     drafts) — including when edits arrive while a create is still in flight.

const DEFAULT_DEBOUNCE_MS = 2000;

export type DraftSaveStatus = "idle" | "saving" | "saved";

/** The compose fields the scheduler watches and serializes into a save. */
export interface DraftSnapshot {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  jobId?: string;
  replyToMessageId?: string;
}

/** Body POSTed to /api/email/drafts; draftId present only on update. */
export interface DraftSavePayload extends DraftSnapshot {
  draftId?: string;
}

export interface DraftSaveResult {
  id: string;
}

export interface DraftAutosaveOptions {
  /** Performs the actual network save; resolves with the persisted draft id. */
  save: (payload: DraftSavePayload) => Promise<DraftSaveResult>;
  /** Debounce window in ms (default 2000, matching the estimate autosave). */
  debounceMs?: number;
  /** Notified on every status transition so a React shell can render it. */
  onStatusChange?: (status: DraftSaveStatus) => void;
  /** Resumed-draft id, so the first autosave updates rather than creates. */
  initialDraftId?: string | null;
}

export interface DraftAutosaveScheduler {
  /** (Re)baseline to an opened/resumed snapshot; edits past this go dirty. */
  reset(baseline: DraftSnapshot, draftId?: string | null): void;
  /** Feed the latest compose snapshot; schedules a debounced save if dirty. */
  notifyChange(snapshot: DraftSnapshot): void;
  /** Persist any pending change immediately (used on close). */
  flush(): Promise<void>;
  /** Drop any pending change without saving (used on send). */
  cancel(): void;
  getStatus(): DraftSaveStatus;
  getDraftId(): string | null;
}

/** Stable string key of the savable fields, for dirty comparison. */
function serialize(s: DraftSnapshot): string {
  return JSON.stringify([
    s.accountId,
    s.to,
    s.cc ?? "",
    s.bcc ?? "",
    s.subject,
    s.bodyText,
    s.bodyHtml,
    s.jobId ?? "",
    s.replyToMessageId ?? "",
  ]);
}

export function createDraftAutosaveScheduler(
  opts: DraftAutosaveOptions,
): DraftAutosaveScheduler {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  // Last successfully-saved (or opened/resumed) snapshot. A snapshot equal to
  // this is "clean" and never triggers a save.
  let baseline: DraftSnapshot | null = null;
  let baselineKey = "";
  // Latest dirty snapshot awaiting a save, or null when clean.
  let pending: DraftSnapshot | null = null;
  let draftId: string | null = opts.initialDraftId ?? null;
  let status: DraftSaveStatus = "idle";
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Guards the create-then-update transition: while a save is awaiting we must
  // not start a second one, or two concurrent creates would each insert a draft
  // (the first hasn't returned its id yet) — duplicate drafts.
  let inFlight = false;

  function setStatus(next: DraftSaveStatus) {
    if (status === next) return;
    status = next;
    opts.onStatusChange?.(next);
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runSave();
    }, debounceMs);
  }

  async function runSave(): Promise<void> {
    if (pending === null) return;
    // A save is already in flight — leave `pending` set; the in-flight save's
    // finally block reschedules once it has the draft id.
    if (inFlight) return;

    const snapshot = pending;
    pending = null;
    inFlight = true;
    setStatus("saving");
    let failed = false;
    try {
      const payload: DraftSavePayload = {
        ...snapshot,
        draftId: draftId ?? undefined,
      };
      const result = await opts.save(payload);
      draftId = result.id;
      baseline = snapshot;
      baselineKey = serialize(snapshot);
      setStatus("saved");
    } catch {
      // A failed save must not surface as "Saved" or escape as an unhandled
      // rejection. Preserve the unsaved snapshot so a later edit or the
      // flush-on-close retries it, and return to idle. We deliberately do NOT
      // auto-reschedule here — that would spin every debounce on a persistent
      // failure (e.g. a 400). The next edit/flush is the retry trigger.
      failed = true;
      if (pending === null) pending = snapshot;
      setStatus("idle");
    } finally {
      inFlight = false;
      // A genuinely newer edit arrived mid-save — debounce and save it (now
      // with the draft id). Skipped on the failure path to avoid a retry spin.
      if (!failed && pending !== null) schedule();
    }
  }

  return {
    reset(newBaseline, newDraftId) {
      clearTimer();
      pending = null;
      baseline = newBaseline;
      baselineKey = serialize(newBaseline);
      if (newDraftId !== undefined) draftId = newDraftId;
      setStatus("idle");
    },

    notifyChange(snapshot) {
      // Before a baseline is established, the first snapshot simply becomes the
      // baseline (programmatic open-fill is never treated as a user edit).
      if (baseline === null) {
        baseline = snapshot;
        baselineKey = serialize(snapshot);
        return;
      }
      if (serialize(snapshot) === baselineKey) {
        // Back to clean (e.g. an edit was reverted) — drop the pending save.
        pending = null;
        clearTimer();
        return;
      }
      pending = snapshot;
      schedule();
    },

    async flush() {
      clearTimer();
      await runSave();
    },

    cancel() {
      clearTimer();
      pending = null;
    },

    getStatus() {
      return status;
    },

    getDraftId() {
      return draftId;
    },
  };
}
