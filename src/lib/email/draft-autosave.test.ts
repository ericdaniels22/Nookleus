import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDraftAutosaveScheduler,
  type DraftSnapshot,
  type DraftSavePayload,
  type DraftSaveResult,
} from "./draft-autosave";

const DEBOUNCE = 2000;

function snap(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    accountId: "acc-1",
    to: "",
    subject: "",
    bodyText: "",
    bodyHtml: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createDraftAutosaveScheduler", () => {
  it("coalesces rapid edits into a single debounced save of the latest snapshot", async () => {
    const save = vi.fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>(
      async () => ({ id: "draft-1" }),
    );
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });

    scheduler.reset(snap()); // opened with an empty baseline

    scheduler.notifyChange(snap({ subject: "Hel" }));
    scheduler.notifyChange(snap({ subject: "Hello" }));
    scheduler.notifyChange(snap({ subject: "Hello there" }));

    // Nothing saved before the debounce window elapses.
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      accountId: "acc-1",
      subject: "Hello there",
    });
    // First save creates — no draftId yet.
    expect(save.mock.calls[0][0].draftId).toBeUndefined();
  });

  it("never saves while clean, and a reverted edit cancels a pending save", async () => {
    const save = vi.fn(async () => ({ id: "draft-1" }));
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });

    scheduler.reset(snap({ subject: "Hello" }));

    // A snapshot identical to the baseline must not schedule anything.
    scheduler.notifyChange(snap({ subject: "Hello" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).not.toHaveBeenCalled();

    // Edit, then revert back to the baseline within the debounce window.
    scheduler.notifyChange(snap({ subject: "Hello!" }));
    scheduler.notifyChange(snap({ subject: "Hello" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).not.toHaveBeenCalled();
  });

  it("creates on first save, then reuses the returned id — no duplicate drafts even if an edit lands mid-flight", async () => {
    let resolveFirst!: (r: { id: string }) => void;
    const firstSave = new Promise<{ id: string }>((r) => {
      resolveFirst = r;
    });
    const save = vi
      .fn<(p: { draftId?: string }) => Promise<{ id: string }>>()
      .mockReturnValueOnce(firstSave) // first create hangs until we resolve it
      .mockResolvedValue({ id: "draft-99" }); // any later save

    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    // First edit → first (create) save fires and stays in flight.
    scheduler.notifyChange(snap({ subject: "A" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].draftId).toBeUndefined();

    // Edit again while the create is still in flight — a second save must NOT
    // start yet (it would create a duplicate, the id isn't known).
    scheduler.notifyChange(snap({ subject: "AB" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);

    // The create returns its id; the queued edit now saves as an UPDATE.
    resolveFirst({ id: "draft-99" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].draftId).toBe("draft-99");
    expect(scheduler.getDraftId()).toBe("draft-99");
  });

  it("flush() persists a pending edit immediately, then is a no-op when clean (close)", async () => {
    const save = vi.fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>(
      async () => ({ id: "draft-1" }),
    );
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Closing now" }));
    // No timer advance — flush must not wait for the debounce window.
    await scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ subject: "Closing now" });

    // Nothing pending anymore — a second flush saves nothing.
    await scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush() waits for an in-flight save, then persists the newest pending edit (no lost last edit on close)", async () => {
    // Close while a create is still in flight AND a newer edit is pending. The
    // old flush resolved instantly (the in-flight save blocked runSave), so the
    // newest edit was never saved and the in-flight save then re-armed a timer
    // that fired after the window closed (issue #657 M2).
    let resolveCreate!: (r: { id: string }) => void;
    const createPromise = new Promise<{ id: string }>((r) => {
      resolveCreate = r;
    });
    const save = vi
      .fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>()
      .mockReturnValueOnce(createPromise)
      .mockResolvedValue({ id: "draft-3" });
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "First" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // create fires, stays in flight
    expect(save).toHaveBeenCalledTimes(1);

    // A newer edit arrives while the create is still in flight.
    scheduler.notifyChange(snap({ subject: "Newest" }));

    // Close: flush must persist the newest edit — not resolve instantly.
    const flushing = scheduler.flush();
    resolveCreate({ id: "draft-3" });
    await flushing;

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      subject: "Newest",
      draftId: "draft-3", // the newest edit updates the just-created draft
    });

    // No autosave fires after the window has closed.
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("cancel() drops a pending edit so no save fires, and resolves null when no draft was ever created (send)", async () => {
    const save = vi.fn(async () => ({ id: "draft-1" }));
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Discard me" }));
    // The common no-in-flight branch must resolve null (no backing draft to
    // delete), not float an unawaited promise or return garbage.
    const settledId = await scheduler.cancel();
    expect(settledId).toBeNull();

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).not.toHaveBeenCalled();
  });

  it("cancel() awaits an in-flight create and resolves the real draft id (no sent-draft orphan)", async () => {
    // Sending while the FIRST create-autosave is still in flight: the send must
    // learn the real draft id so it can delete the backing draft, and no second
    // save may fire afterward to insert an orphan (issue #657 M1).
    let resolveCreate!: (r: { id: string }) => void;
    const createPromise = new Promise<{ id: string }>((r) => {
      resolveCreate = r;
    });
    const save = vi
      .fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>()
      .mockReturnValueOnce(createPromise)
      .mockResolvedValue({ id: "draft-7" });
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "A" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // create fires, stays in flight
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.getDraftId()).toBeNull(); // id not known yet

    // User hits send while the create is still in flight.
    const settled = scheduler.cancel();
    resolveCreate({ id: "draft-7" });
    const settledId = await settled;

    // The send now knows the real draft id to delete.
    expect(settledId).toBe("draft-7");
    expect(scheduler.getDraftId()).toBe("draft-7");

    // No further autosave fires after cancel — nothing to orphan.
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("treats attaching a file as a dirty edit and carries the attachments in the saved payload", async () => {
    // The draft snapshot must include uploaded attachments so attaching one
    // marks the draft dirty (autosaves) and the persisted draft can report its
    // attachments honestly rather than hardcoding "none" (issue #657 L1).
    const save = vi.fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>(
      async () => ({ id: "draft-1" }),
    );
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap()); // opened with no attachments

    const file = {
      filename: "quote.pdf",
      content_type: "application/pdf",
      file_size: 1234,
      storage_path: "drafts/1-quote.pdf",
    };
    scheduler.notifyChange(snap({ attachments: [file] }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].attachments).toEqual([file]);
  });

  it("reset() rescues a still-pending edit by saving it before re-baselining (reopen never drops edits)", async () => {
    // A debounced edit is waiting when the window re-baselines (reopen, or a
    // parent re-render with changed default props). The old reset dropped that
    // pending edit with no save; it must be persisted first (issue #657 M5).
    const save = vi.fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>(
      async () => ({ id: "draft-1" }),
    );
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap()); // opened
    scheduler.notifyChange(snap({ subject: "Half-typed" })); // armed, not yet fired
    expect(save).not.toHaveBeenCalled();

    // Re-baseline before the debounce window elapses.
    scheduler.reset(snap({ subject: "Reopened content" }), "draft-1");
    await vi.advanceTimersByTimeAsync(0); // let the rescue save run

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ subject: "Half-typed" });

    // The new baseline is adopted: a snapshot equal to it stays clean (the
    // rescue's late save must not have clobbered the freshly-set baseline).
    scheduler.notifyChange(snap({ subject: "Reopened content" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("surfaces a visible 'error' state when a save fails, never 'saved', and keeps the edit", async () => {
    const save = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ id: "draft-1" });
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Retry me" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
    // A failed save must not read as "saved"; it surfaces a distinct, visible
    // "not saved" state so the user is not misled (issue #657 L2).
    expect(scheduler.getStatus()).toBe("error");
    expect(scheduler.getDraftId()).toBeNull();

    // The edit isn't lost — flushing on close retries it and succeeds.
    await scheduler.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(scheduler.getStatus()).toBe("saved");
    expect(scheduler.getDraftId()).toBe("draft-1");
  });

  it("clears the stale 'error' state when a failed edit is reverted back to clean (no lingering 'Not saved')", async () => {
    // A save fails (status 'error', the edit held as pending). The user then
    // deletes the edit, returning to the saved baseline. There is now nothing to
    // persist, so the 'Not saved — will retry' badge must clear rather than stick
    // forever on a draft that has no pending change (issue #657 review).
    const save = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValue(new Error("offline"));
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Oops" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scheduler.getStatus()).toBe("error");

    // Revert all the way back to the (empty) baseline.
    scheduler.notifyChange(snap());
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(scheduler.getStatus()).not.toBe("error");
    // Nothing pending → no retry spin.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a failed reset-rescue stays isolated: it never re-targets the freshly-adopted draft nor leaks its status into the new session", async () => {
    // A reused scheduler re-baselines across compose sessions. When reset()
    // rescues a pending edit from the OLD draft and that rescue save FAILS, it
    // must not (a) resurface as the NEW session's 'error' status, nor (b) be
    // re-saved against the new draft id, clobbering it with stale content
    // (issue #657 review: cross-draft clobber + status leak).
    const save = vi
      .fn<(p: DraftSavePayload) => Promise<DraftSaveResult>>()
      .mockRejectedValueOnce(new Error("rescue failed")) // the rescue save fails
      .mockResolvedValue({ id: "draft-new" });
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap({ subject: "Base0" }), "draft-old");

    scheduler.notifyChange(snap({ subject: "OldStale" })); // pending vs draft-old
    // Re-baseline to a DIFFERENT draft before the debounce fires.
    scheduler.reset(snap({ subject: "Reopened" }), "draft-new");
    await vi.advanceTimersByTimeAsync(0); // let the failing rescue settle

    // The fresh session is not showing the old draft's failure.
    expect(scheduler.getStatus()).not.toBe("error");

    // A close-flush must not write the stale "OldStale" content onto draft-new.
    await scheduler.flush();
    const wroteStaleToNew = save.mock.calls.some(
      ([p]) => p.subject === "OldStale" && p.draftId === "draft-new",
    );
    expect(wroteStaleToNew).toBe(false);
  });
});
