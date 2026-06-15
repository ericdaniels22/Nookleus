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

// "error" surfaces a failed autosave as a visible "not saved" state, distinct
// from saving/saved, so the user is never misled into believing a draft saved
// (issue #657 L2).
export type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

/** A draft attachment already uploaded to storage (the /attachments/upload
 *  response shape). Carried in the snapshot so attaching marks the draft dirty
 *  and the saved draft can report its attachments honestly (issue #657 L1). */
export interface DraftAttachment {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

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
  attachments?: DraftAttachment[];
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
  /** Drop any pending change without saving, wait for any in-flight save to
   *  settle, and resolve the persisted draft id (used on send, so the caller
   *  can delete the right draft and no in-flight create orphans one). */
  cancel(): Promise<string | null>;
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
    // Identity by storage path: attaching/removing a file is a dirty edit, but
    // re-uploading the same set is not.
    (s.attachments ?? []).map((a) => a.storage_path),
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
  // The promise of the save currently in flight, so close (flush) and send
  // (cancel) can await it — learning the created draft id and never racing a
  // second save past it (issue #657).
  let inFlightDone: Promise<void> | null = null;

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

  // Persist one snapshot on the normal autosave path: on success it adopts the
  // returned draft id and advances the saved baseline (so the saved content is
  // now "clean"). The reset rescue does NOT go through here — it uses the
  // isolated rescueSave below precisely so it can't advance this baseline or
  // status (issue #657 review).
  function doSave(snapshot: DraftSnapshot): Promise<void> {
    inFlight = true;
    setStatus("saving");
    const run = async () => {
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
        // flush-on-close retries it, and surface a visible "not saved" state
        // (issue #657 L2). We deliberately do NOT auto-reschedule here — that
        // would spin every debounce on a persistent failure (e.g. a 400). The
        // next edit/flush is the retry trigger.
        failed = true;
        if (pending === null) pending = snapshot;
        setStatus("error");
      } finally {
        inFlight = false;
        // A genuinely newer edit arrived mid-save — debounce and save it (now
        // with the draft id). Skipped on the failure path to avoid a retry spin.
        if (!failed && pending !== null) schedule();
      }
    };
    inFlightDone = run();
    return inFlightDone;
  }

  // Fire-and-forget rescue of a pending edit when reset() re-baselines (reopen /
  // changed props). It persists the edit against the CURRENT (old) draft id,
  // best-effort, WITHOUT touching the new session's shared status, in-flight
  // tracking, or `pending`. That isolation is deliberate: a single scheduler
  // instance is reused across compose sessions (the modal stays mounted, only
  // `open` toggles), so the rescue's own success/failure must never leak into
  // the freshly-adopted draft's status, nor — on failure — be re-stashed and
  // later re-saved against the NEW draft id, clobbering it with stale content
  // (issue #657 review: cross-draft clobber + status leak across a reused
  // instance). Captured `rescueDraftId` is read synchronously, before reset()
  // adopts the new id, so the rescue always targets the draft the edit belongs to.
  function rescueSave(snapshot: DraftSnapshot): void {
    const rescueDraftId = draftId;
    void (async () => {
      try {
        await opts.save({ ...snapshot, draftId: rescueDraftId ?? undefined });
      } catch {
        /* best-effort; never re-stash or surface — see above */
      }
    })();
  }

  // Save the current pending edit (the normal debounced/flush path). A no-op
  // when clean; when a save is already in flight, returns that save's promise
  // so callers can await it without starting a second create.
  function runSave(): Promise<void> {
    if (pending === null) return Promise.resolve();
    // A save is already in flight — leave `pending` set; the in-flight save's
    // finally block reschedules once it has the draft id.
    if (inFlight) return inFlightDone ?? Promise.resolve();
    const snapshot = pending;
    pending = null;
    return doSave(snapshot);
  }

  return {
    reset(newBaseline, newDraftId) {
      clearTimer();
      // Rescue a still-pending (debounced) edit before the reopened content
      // takes over, so a reopen never silently drops the user's latest change
      // (issue #657 M5). The rescue is isolated (see rescueSave): it targets the
      // OLD draft and can neither leak its status into the new session nor clobber
      // the freshly-adopted baseline. A save already in flight owns its own
      // snapshot, so we don't start a nested save under it here.
      if (pending !== null && !inFlight) rescueSave(pending);
      pending = null;
      baseline = newBaseline;
      baselineKey = serialize(newBaseline);
      if (newDraftId !== undefined) draftId = newDraftId;
      // A (re)open is a fresh session: reset the visible status to idle. The
      // rescue (if any) runs silently and never drives this indicator.
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
        // If the last save FAILED, reverting all the way back to the saved
        // baseline leaves nothing to persist — clear the stale "error" so the
        // "Not saved — will retry" badge doesn't stick forever on a draft that
        // has no pending change and will never retry (issue #657 review). A
        // genuine in-flight save owns its own status, so don't disturb it.
        if (status === "error" && !inFlight) {
          setStatus(draftId !== null ? "saved" : "idle");
        }
        return;
      }
      pending = snapshot;
      schedule();
    },

    async flush() {
      clearTimer();
      // If a save is already running, wait for it to settle first (so we don't
      // start a duplicate create), THEN persist whatever is still pending — the
      // newest edit at close time, which the in-flight save did not include
      // (issue #657 M2). Without the await, flush resolved instantly and the
      // last edit was lost while the in-flight save re-armed a post-close timer.
      if (inFlight && inFlightDone) {
        try {
          await inFlightDone;
        } catch {
          /* doSave swallows its own errors; never rejects */
        }
      }
      // The settled save may have re-armed the debounce for the pending edit;
      // cancel it and persist synchronously so nothing fires after close.
      clearTimer();
      await runSave();
    },

    async cancel() {
      clearTimer();
      // Drop the pending edit — send discards the draft, it must not be saved.
      pending = null;
      // Wait for any in-flight save to settle so its created draft id is known
      // (the send needs it to delete the draft) and no second save inserts an
      // orphan after the message is sent (issue #657 M1).
      if (inFlight && inFlightDone) {
        try {
          await inFlightDone;
        } catch {
          /* doSave swallows its own errors; never rejects */
        }
      }
      // The in-flight save's finally may have re-armed a timer if a new edit
      // slipped in; clear it and re-drop so nothing autosaves post-send.
      clearTimer();
      pending = null;
      return draftId;
    },

    getStatus() {
      return status;
    },

    getDraftId() {
      return draftId;
    },
  };
}
