// Behavior tests for useAnnotatorAutoSave — the controller behind issue #807's
// ADR 0024 split write. The hook debounces a CHEAP markup upsert
// (photo_annotations.annotation_data) on every edit, and rebuilds the EXPENSIVE
// flattened render (Storage upload + photos.annotated_path) ONLY on leave/close.
// Tests drive the real hook through its public controller against a faked
// Supabase + an injected blob-capture callback, with fake timers standing in for
// the debounce — so they survive a later swap of the internal debounce/retry
// machinery (e.g. onto #806's shared primitive).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAnnotatorAutoSave } from "./photo-annotator-auto-save";
import type { AnnotationData } from "@/lib/jobs/photo-annotation-format";

// Silent success / warn-only-after-retries: stub sonner so toasts are inert and
// assertable.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));
import { toast } from "sonner";

const annotationData: AnnotationData = {
  format: 3,
  canvas: { version: "7.2.0", objects: [{ type: "FabricArrow" }] },
};

// A faked Supabase transport covering BOTH split-write paths:
//   • persistPhotoMarkup → from("photo_annotations").select…/update…/insert
//   • persistAnnotatedRender → storage.from("photos").upload/remove +
//     from("photos").update().eq()
// `existingAnnotation` toggles the markup update-vs-insert branch.
function makeStore(
  opts: { existingAnnotation?: { id: string } | null } = {},
) {
  const { existingAnnotation = null } = opts;

  const annInsert = vi.fn().mockResolvedValue({ error: null });
  const annUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const annUpdate = vi.fn(() => ({ eq: annUpdateEq }));
  const annMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: existingAnnotation, error: null });
  const annLimit = vi.fn(() => ({ maybeSingle: annMaybeSingle }));
  const annSelectEq = vi.fn(() => ({ limit: annLimit }));
  const annSelect = vi.fn(() => ({ eq: annSelectEq }));

  const photosUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const photosUpdate = vi.fn(() => ({ eq: photosUpdateEq }));

  const from = vi.fn((table: string) => {
    if (table === "photo_annotations")
      return { select: annSelect, update: annUpdate, insert: annInsert };
    if (table === "photos") return { update: photosUpdate };
    throw new Error(`unexpected table ${table}`);
  });

  const upload = vi.fn().mockResolvedValue({ data: { path: "x" }, error: null });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const storageFrom = vi.fn(() => ({ upload, remove }));
  const storage = { from: storageFrom };

  const store = { from, storage } as unknown as Parameters<
    typeof useAnnotatorAutoSave
  >[0]["supabase"];

  return {
    store,
    annInsert,
    annUpdate,
    annUpdateEq,
    annSelect,
    upload,
    remove,
    photosUpdate,
    photosUpdateEq,
  };
}

function makeConfig(
  store: ReturnType<typeof makeStore>["store"],
  overrides: Partial<Parameters<typeof useAnnotatorAutoSave>[0]> = {},
): Parameters<typeof useAnnotatorAutoSave>[0] {
  return {
    supabase: store,
    photo: { id: "p1", storage_path: "org/p1.jpg", annotated_path: null },
    organizationId: "org-1",
    captureFlattenedBlob: vi.fn(
      async () => new Blob(["png"], { type: "image/png" }),
    ),
    ...overrides,
  };
}

// jsdom's document.visibilityState is a read-only getter; override it so a
// visibilitychange event can simulate the page being backgrounded/hidden.
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // The sonner mock is module-level — clear its call history (and every other
  // mock's) so a warn fired in one test can't leak into the next.
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility("visible"); // reset so a hidden value can't leak to the next test
});

describe("useAnnotatorAutoSave — debounced markup save", () => {
  it("upserts the markup once, silently, after the debounce — and never touches Storage", async () => {
    const { store, annInsert, upload, photosUpdate } = makeStore();
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // Still inside the debounce window — nothing written yet.
    expect(annInsert).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Exactly one cheap upsert, carrying the org/photo/markup envelope.
    expect(annInsert).toHaveBeenCalledTimes(1);
    expect(annInsert).toHaveBeenCalledWith({
      organization_id: "org-1",
      photo_id: "p1",
      annotation_data: annotationData,
      created_by: "Eric",
    });

    // The EXPENSIVE half stayed untouched — no flatten/upload, no annotated_path.
    expect(upload).not.toHaveBeenCalled();
    expect(photosUpdate).not.toHaveBeenCalled();

    // Silent success — no toast either way.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("collapses a flurry of edits inside the window into a single upsert of the latest markup", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    const v1: AnnotationData = {
      format: 3,
      canvas: { version: "7.2.0", objects: [{ type: "FabricArrow", labelText: "a" }] },
    };
    const v2: AnnotationData = {
      format: 3,
      canvas: { version: "7.2.0", objects: [{ type: "FabricArrow", labelText: "ab" }] },
    };
    const v3: AnnotationData = {
      format: 3,
      canvas: { version: "7.2.0", objects: [{ type: "FabricArrow", labelText: "abc" }] },
    };

    // Three edits, each landing before the previous debounce could fire.
    act(() => {
      result.current.scheduleMarkupSave(v1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    act(() => {
      result.current.scheduleMarkupSave(v2);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    act(() => {
      result.current.scheduleMarkupSave(v3);
    });

    // No write has fired yet — the timer keeps getting reset.
    expect(annInsert).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Exactly one upsert, carrying ONLY the final state.
    expect(annInsert).toHaveBeenCalledTimes(1);
    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ annotation_data: v3 }),
    );
  });
});

describe("useAnnotatorAutoSave — flushAndRebuild (leave/close)", () => {
  it("flushes pending markup, then flattens + uploads + repoints annotated_path once", async () => {
    const { store, annInsert, upload, photosUpdate, photosUpdateEq } =
      makeStore();
    const capture = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const onPersisted = vi.fn();
    const config = makeConfig(store, {
      captureFlattenedBlob: capture,
      onPersisted,
    });
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    // An edit is still inside the debounce window when the user leaves.
    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    await act(async () => {
      await result.current.flushAndRebuild();
    });

    // The cheap half was flushed immediately (not left waiting on the timer).
    expect(annInsert).toHaveBeenCalledTimes(1);
    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ annotation_data: annotationData }),
    );

    // The expensive half ran exactly once: capture → upload → repoint the row.
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(photosUpdate).toHaveBeenCalledTimes(1);
    expect(photosUpdate).toHaveBeenCalledWith({
      annotated_path: expect.stringContaining("-annotated-"),
    });
    expect(photosUpdateEq).toHaveBeenCalledWith("id", "p1");

    // The host is told to refresh exactly once.
    expect(onPersisted).toHaveBeenCalledTimes(1);
  });

  it("never flattens or captures the canvas on the debounced markup path", async () => {
    const { store, annInsert, upload } = makeStore();
    const capture = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const config = makeConfig(store, { captureFlattenedBlob: capture });
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // The markup landed…
    expect(annInsert).toHaveBeenCalledTimes(1);
    // …but the canvas was never touched: no flatten, no upload. The expensive
    // rebuild belongs to flushAndRebuild alone.
    expect(capture).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("useAnnotatorAutoSave — retry then warn", () => {
  it("retries a failing markup upsert with backoff, warning once only after retries are exhausted", async () => {
    const { store, annInsert } = makeStore();
    // Every upsert fails — persistPhotoMarkup throws on the returned error.
    annInsert.mockResolvedValue({ error: { message: "network" } });
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // Attempt 1 fires after the debounce — fails, but stays silent (retrying).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(annInsert).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();

    // Backoff retries: 1s, then 2s, then 4s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(annInsert).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(annInsert).toHaveBeenCalledTimes(3);
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    // Fourth attempt fails → retries exhausted → exactly one warn, fired only now.
    expect(annInsert).toHaveBeenCalledTimes(4);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("recovers silently when a retry succeeds — the write lands and no warning shows", async () => {
    const { store, annInsert } = makeStore();
    // Fail the first attempt, then succeed on the retry.
    annInsert
      .mockResolvedValueOnce({ error: { message: "network" } })
      .mockResolvedValue({ error: null });
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // Attempt 1 (debounce) fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(annInsert).toHaveBeenCalledTimes(1);

    // Retry 1 (1s backoff) succeeds — the markup lands.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(annInsert).toHaveBeenCalledTimes(2);

    // No further retries, and silence on success.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(annInsert).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("useAnnotatorAutoSave — flush on teardown", () => {
  it("flushes a pending markup edit when the annotator unmounts mid-debounce", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { result, unmount } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });
    // Still inside the debounce window — the timer hasn't fired.
    expect(annInsert).not.toHaveBeenCalled();

    // The annotator closes before the debounce elapses.
    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0); // let the best-effort write settle
    });

    expect(annInsert).toHaveBeenCalledTimes(1);
    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ annotation_data: annotationData }),
    );
  });

  it("writes nothing when the annotator unmounts with no pending edit", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { unmount } = renderHook(() => useAnnotatorAutoSave(config));

    await act(async () => {
      unmount();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(annInsert).not.toHaveBeenCalled();
  });

  it("flushes a pending markup edit on pagehide (tab close / refresh)", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));
    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // Hard unload — React cleanup never runs, so the listener must carry it.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ annotation_data: annotationData }),
    );
  });

  it("flushes on visibilitychange when the page becomes hidden (iOS background)", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ annotation_data: annotationData }),
    );
  });

  it("does not flush on visibilitychange when the page stays visible", async () => {
    const { store, annInsert } = makeStore();
    const config = makeConfig(store);
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // Returning to the foreground is not a teardown — the edit keeps debouncing.
    await act(async () => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(annInsert).not.toHaveBeenCalled();
  });
});

describe("useAnnotatorAutoSave — rebuild-on-leave targets the leaving photo", () => {
  it("attributes a still-pending edit to the OUTGOING photo even after the host advanced to the next one", async () => {
    const { store, annInsert, photosUpdateEq } = makeStore();
    const leaving = { id: "p1", storage_path: "org/p1.jpg", annotated_path: null };
    const next = { id: "p2", storage_path: "org/p2.jpg", annotated_path: null };

    const { result, rerender } = renderHook(
      ({ photo }) => useAnnotatorAutoSave(makeConfig(store, { photo })),
      { initialProps: { photo: leaving } },
    );

    // Edit photo p1 — the write is still inside the debounce window.
    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });

    // The host swaps to p2 (configRef.current.photo advances) BEFORE the leave
    // handler's async tail runs — exactly the nav race.
    rerender({ photo: next });

    // The leave handler is invoked with the OUTGOING photo.
    await act(async () => {
      await result.current.flushAndRebuild(leaving);
    });

    // Both halves of the split write land on p1 — never the now-current p2.
    expect(annInsert).toHaveBeenCalledWith(
      expect.objectContaining({ photo_id: "p1" }),
    );
    expect(photosUpdateEq).toHaveBeenCalledWith("id", "p1");
  });
});

describe("useAnnotatorAutoSave — crop stays explicit", () => {
  it("rebuilds to a derived annotated render only — never the original file or a -original backup", async () => {
    const { store, upload, photosUpdate } = makeStore();
    const config = makeConfig(store); // storage_path "org/p1.jpg"
    const { result } = renderHook(() => useAnnotatorAutoSave(config));

    act(() => {
      result.current.scheduleMarkupSave(annotationData);
    });
    await act(async () => {
      await result.current.flushAndRebuild();
    });

    // The flattened PNG lands on a DERIVED annotated path — not the source image,
    // and not a `-original` backup (that backup belongs to the crop confirm step).
    const uploadPath = upload.mock.calls[0][0] as string;
    expect(uploadPath).toContain("-annotated-");
    expect(uploadPath).not.toBe("org/p1.jpg");
    expect(uploadPath).not.toContain("-original");

    // The row update repoints annotated_path and nothing else — storage_path,
    // the pointer to the original image, is never rewritten by auto-save.
    const updatePayload = (photosUpdate.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(updatePayload)).toEqual(["annotated_path"]);
  });
});
