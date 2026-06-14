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

  it("cancel() drops a pending edit so no save fires (send)", async () => {
    const save = vi.fn(async () => ({ id: "draft-1" }));
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Discard me" }));
    scheduler.cancel();

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the edit pending and does not mark saved when a save fails", async () => {
    const save = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ id: "draft-1" });
    const scheduler = createDraftAutosaveScheduler({ save, debounceMs: DEBOUNCE });
    scheduler.reset(snap());

    scheduler.notifyChange(snap({ subject: "Retry me" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus()).toBe("idle"); // never "saved" on failure
    expect(scheduler.getDraftId()).toBeNull();

    // The edit isn't lost — flushing on close retries it and succeeds.
    await scheduler.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(scheduler.getStatus()).toBe("saved");
    expect(scheduler.getDraftId()).toBe("draft-1");
  });
});
