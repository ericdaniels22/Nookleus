import { describe, it, expect, vi } from "vitest";
import { persistAnnotatedRender } from "./persist-annotated-render";

type Supa = Parameters<typeof persistAnnotatedRender>[0];

function makeStore(updateError: unknown = null) {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn(() => ({ eq }));
  const store = {
    storage: { from: vi.fn(() => ({ upload, remove })) },
    from: vi.fn(() => ({ update })),
  } as unknown as Supa;
  return { store, upload, remove, eq, update };
}

const base = {
  photoId: "p1",
  storagePath: "job-1/abc.jpg",
  blob: new Blob(["x"]),
  token: "k2",
};

describe("persistAnnotatedRender", () => {
  it("uploads to and updates the row with the unique token-derived path", async () => {
    const { store, upload, update } = makeStore();
    const { annotatedPath } = await persistAnnotatedRender(store, {
      ...base,
      previousAnnotatedPath: null,
    });
    expect(annotatedPath).toBe("job-1/abc-annotated-k2.png");
    expect(upload).toHaveBeenCalledWith(
      "job-1/abc-annotated-k2.png",
      base.blob,
      { upsert: true, contentType: "image/png" },
    );
    expect(update).toHaveBeenCalledWith({
      annotated_path: "job-1/abc-annotated-k2.png",
    });
  });

  it("throws and skips the row update + delete when the Storage upload fails", async () => {
    const { store, upload, update, remove } = makeStore();
    // Supabase Storage reports a failed upload in the result, not by throwing.
    upload.mockResolvedValue({ error: new Error("storage 503") });

    await expect(
      persistAnnotatedRender(store, {
        ...base,
        previousAnnotatedPath: "job-1/abc-annotated-k1.png",
      }),
    ).rejects.toThrow("storage 503");

    // The row must never be repointed at a path whose file failed to land…
    expect(update).not.toHaveBeenCalled();
    // …and the prior good render must be left intact.
    expect(remove).not.toHaveBeenCalled();
  });

  it("does NOT delete when there is no previous annotated path", async () => {
    const { store, remove } = makeStore();
    await persistAnnotatedRender(store, { ...base, previousAnnotatedPath: null });
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the prior render when the update SUCCEEDS and the path differs", async () => {
    const { store, remove } = makeStore(/* updateError */ null);
    await persistAnnotatedRender(store, {
      ...base,
      previousAnnotatedPath: "job-1/abc-annotated-k1.png",
    });
    expect(remove).toHaveBeenCalledWith(["job-1/abc-annotated-k1.png"]);
  });

  it("throws and does NOT delete the prior render when the row update returns an error", async () => {
    const { store, remove } = makeStore({ message: "rls denied" });
    // A failed repoint must surface so the rebuild loop retries it (story 25),
    // and the prior good render must survive an unconfirmed repoint.
    await expect(
      persistAnnotatedRender(store, {
        ...base,
        previousAnnotatedPath: "job-1/abc-annotated-k1.png",
      }),
    ).rejects.toEqual({ message: "rls denied" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("does NOT delete when the prior path equals the new path", async () => {
    const { store, remove } = makeStore();
    await persistAnnotatedRender(store, {
      ...base,
      token: "k2",
      previousAnnotatedPath: "job-1/abc-annotated-k2.png",
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("swallows a delete failure (best-effort) without throwing", async () => {
    const { store, remove } = makeStore();
    (remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    await expect(
      persistAnnotatedRender(store, {
        ...base,
        previousAnnotatedPath: "job-1/abc-annotated-k1.png",
      }),
    ).resolves.toEqual({ annotatedPath: "job-1/abc-annotated-k2.png" });
  });
});
