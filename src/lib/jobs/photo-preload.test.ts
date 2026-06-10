import { describe, it, expect, vi, afterEach } from "vitest";
import { pickPreloadUrls } from "./photo-preload";

const SUPABASE_URL = "https://proj.supabase.co";

afterEach(() => vi.unstubAllEnvs());

describe("pickPreloadUrls — preserves the newest-first order of the loaded rows", () => {
  it("returns one grid preview URL per photo, in the order given", () => {
    const urls = pickPreloadUrls(
      [
        { annotated_path: null, storage_path: "originals/0.jpg" },
        { annotated_path: null, storage_path: "originals/1.jpg" },
        { annotated_path: null, storage_path: "originals/2.jpg" },
      ],
      SUPABASE_URL,
      3,
    );
    expect(urls).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/0.jpg",
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/1.jpg",
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/2.jpg",
    ]);
  });
});

describe("pickPreloadUrls — caps at the screenful size", () => {
  it("returns only the first `screenful` URLs when more photos are loaded", () => {
    const urls = pickPreloadUrls(
      [
        { annotated_path: null, storage_path: "originals/0.jpg" },
        { annotated_path: null, storage_path: "originals/1.jpg" },
        { annotated_path: null, storage_path: "originals/2.jpg" },
        { annotated_path: null, storage_path: "originals/3.jpg" },
        { annotated_path: null, storage_path: "originals/4.jpg" },
      ],
      SUPABASE_URL,
      2,
    );
    expect(urls).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/0.jpg",
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/1.jpg",
    ]);
  });

  it("returns exactly the loaded rows when the count equals the screenful (no off-by-one)", () => {
    const urls = pickPreloadUrls(
      [
        { annotated_path: null, storage_path: "originals/0.jpg" },
        { annotated_path: null, storage_path: "originals/1.jpg" },
      ],
      SUPABASE_URL,
      2,
    );
    expect(urls).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/0.jpg",
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/1.jpg",
    ]);
  });
});

describe("pickPreloadUrls — a Job with fewer Photos than a screenful", () => {
  it("returns just the loaded rows, not padded to the screenful size", () => {
    const urls = pickPreloadUrls(
      [
        { annotated_path: null, storage_path: "originals/0.jpg" },
        { annotated_path: null, storage_path: "originals/1.jpg" },
      ],
      SUPABASE_URL,
      12,
    );
    expect(urls).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/0.jpg",
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/1.jpg",
    ]);
  });
});

describe("pickPreloadUrls — an empty Job", () => {
  it("returns an empty list when there are no Photos to preload", () => {
    expect(pickPreloadUrls([], SUPABASE_URL, 12)).toEqual([]);
  });
});

describe("pickPreloadUrls — uses the resolver's grid variant", () => {
  // Preloading must warm the SAME small previews the grid renders, not the
  // full-resolution originals (#395 / ADR 0008) — otherwise we'd waste data
  // and still miss the grid's cache. With resize enabled, the "grid" variant
  // yields a render/resize URL; "full" would yield the plain object URL.
  it("preloads small resized previews (grid render URLs), not full-resolution originals", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const urls = pickPreloadUrls(
      [{ annotated_path: null, storage_path: "originals/abc.jpg" }],
      SUPABASE_URL,
      12,
    );
    expect(urls).toEqual([
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&height=400&quality=60&resize=cover",
    ]);
  });
});
