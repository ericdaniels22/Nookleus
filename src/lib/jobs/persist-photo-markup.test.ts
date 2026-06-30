import { describe, it, expect, vi } from "vitest";
import { persistPhotoMarkup } from "./persist-photo-markup";
import type { AnnotationData } from "./photo-annotation-format";

type Supa = Parameters<typeof persistPhotoMarkup>[0];

const annotationData: AnnotationData = {
  format: 3,
  canvas: { version: "7.2.0", objects: [{ type: "FabricArrow" }] },
};

// A faked Supabase transport that records the select → update/insert chain
// persistPhotoMarkup walks. `existing` controls whether a prior annotation row
// is found (the update branch) or not (the insert branch); the *Error options
// drive the write-failure paths.
function makeStore(
  opts: {
    existing?: { id: string } | null;
    updateError?: unknown;
    insertError?: unknown;
  } = {},
) {
  const { existing = null, updateError = null, insertError = null } = opts;

  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const selectEq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq: selectEq }));

  const updateEq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq: updateEq }));

  const insert = vi.fn().mockResolvedValue({ error: insertError });

  const from = vi.fn(() => ({ select, update, insert }));
  const store = { from } as unknown as Supa;
  return { store, from, select, selectEq, update, updateEq, insert };
}

const base = {
  photoId: "p1",
  organizationId: "org-1",
  annotationData,
};

describe("persistPhotoMarkup", () => {
  it("inserts a new annotation row when none exists for the photo", async () => {
    const { store, insert, update } = makeStore({ existing: null });

    await persistPhotoMarkup(store, base);

    expect(insert).toHaveBeenCalledWith({
      organization_id: "org-1",
      photo_id: "p1",
      annotation_data: annotationData,
      created_by: "Eric",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing row's annotation_data in place when one is found", async () => {
    const { store, update, updateEq, insert } = makeStore({
      existing: { id: "ann-9" },
    });

    await persistPhotoMarkup(store, base);

    expect(update).toHaveBeenCalledWith({ annotation_data: annotationData });
    expect(updateEq).toHaveBeenCalledWith("id", "ann-9");
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws when the update write returns an error so the caller can retry", async () => {
    const { store } = makeStore({
      existing: { id: "ann-9" },
      updateError: { message: "5xx" },
    });

    await expect(persistPhotoMarkup(store, base)).rejects.toBeTruthy();
  });

  it("throws when the insert write returns an error so the caller can retry", async () => {
    const { store } = makeStore({
      existing: null,
      insertError: { message: "network" },
    });

    await expect(persistPhotoMarkup(store, base)).rejects.toBeTruthy();
  });
});
