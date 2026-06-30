import { describe, it, expect, vi } from "vitest";
import { persistPhotoMarkup } from "./persist-photo-markup";
import type { AnnotationData } from "./photo-annotation-format";

type Supa = Parameters<typeof persistPhotoMarkup>[0];

const annotationData: AnnotationData = {
  format: 3,
  canvas: { version: "7.2.0", objects: [{ type: "FabricArrow" }] },
};

// A faked Supabase transport that records the update → (maybe) upsert chain
// persistPhotoMarkup walks (issue #848). The re-save path is an UPDATE matched
// by the now-UNIQUE photo_id, whose `.select("id")` returns the rows it touched;
// `updatedRows` controls whether a canonical row already existed (re-save) or
// not (first-time save → upsert). The *Error options drive the write-failure
// paths.
function makeStore(
  opts: {
    updatedRows?: { id: string }[];
    updateError?: unknown;
    upsertError?: unknown;
  } = {},
) {
  const { updatedRows = [], updateError = null, upsertError = null } = opts;

  const updateSelect = vi
    .fn()
    .mockResolvedValue({ data: updatedRows, error: updateError });
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const upsert = vi.fn().mockResolvedValue({ error: upsertError });

  const from = vi.fn(() => ({ update, upsert }));
  const store = { from } as unknown as Supa;
  return { store, from, update, updateEq, updateSelect, upsert };
}

const base = {
  photoId: "p1",
  organizationId: "org-1",
  annotationData,
};

/** A default author resolver for the call sites that don't assert on it. */
const resolveAuthor = () => Promise.resolve("Eric Daniels");

describe("persistPhotoMarkup", () => {
  it("re-save updates annotation_data in place by photo_id, never resolving or rewriting the author (#808/#848)", async () => {
    const { store, update, updateEq, upsert } = makeStore({
      updatedRows: [{ id: "ann-9" }],
    });
    const resolveAuthorSpy = vi.fn().mockResolvedValue("Someone Else");

    await persistPhotoMarkup(store, { ...base, resolveAuthor: resolveAuthorSpy });

    // The existing canonical row is updated in place — matched by photo_id, not
    // a read-then-write by id — carrying only annotation_data.
    expect(update).toHaveBeenCalledWith({ annotation_data: annotationData });
    expect(updateEq).toHaveBeenCalledWith("photo_id", "p1");
    // It kept whoever first authored it: no upsert, and we never even resolve a
    // candidate author (no auth round-trip on the debounced save path).
    expect(upsert).not.toHaveBeenCalled();
    expect(resolveAuthorSpy).not.toHaveBeenCalled();
  });

  it("first-time save upserts on photo_id with the resolved author so concurrent first saves converge to one row (#848)", async () => {
    const { store, upsert } = makeStore({ updatedRows: [] });
    const resolveAuthorSpy = vi.fn().mockResolvedValue("Eric Daniels");

    await persistPhotoMarkup(store, { ...base, resolveAuthor: resolveAuthorSpy });

    // No row existed (update touched nothing) → insert via upsert. onConflict on
    // the UNIQUE photo_id turns a racing concurrent first save into a no-op
    // conflict update instead of a 23505, so both writers converge to one row.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      {
        organization_id: "org-1",
        photo_id: "p1",
        annotation_data: annotationData,
        created_by: "Eric Daniels",
      },
      { onConflict: "photo_id" },
    );
    // The author is resolved lazily — exactly once, only on the insert branch.
    expect(resolveAuthorSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when the update write returns an error so the caller can retry", async () => {
    const { store } = makeStore({
      updatedRows: [{ id: "ann-9" }],
      updateError: { message: "5xx" },
    });

    await expect(
      persistPhotoMarkup(store, { ...base, resolveAuthor }),
    ).rejects.toBeTruthy();
  });

  it("throws when the first-time upsert write returns an error so the caller can retry", async () => {
    const { store } = makeStore({
      updatedRows: [],
      upsertError: { message: "network" },
    });

    await expect(
      persistPhotoMarkup(store, { ...base, resolveAuthor }),
    ).rejects.toBeTruthy();
  });
});
