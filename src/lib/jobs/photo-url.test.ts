import { describe, it, expect, vi, afterEach } from "vitest";
import { photoUrl, originalPhotoUrl, reportCoverPhotoUrl } from "./photo-url";

const SUPABASE_URL = "https://proj.supabase.co";

afterEach(() => vi.unstubAllEnvs());

describe("photoUrl — grid variant, resize flag off", () => {
  it("returns the original object URL when resize is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "");
    const url = photoUrl(
      { annotated_path: null, storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/abc.jpg",
    );
  });
});

describe("photoUrl — grid variant, resize flag on", () => {
  it("returns the resized render/image URL when resize is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: null, storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&height=400&quality=60&resize=cover",
    );
  });
});

describe("photoUrl — annotated photo", () => {
  it("builds the preview from the annotated path when present", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: "annotated/abc.jpg", storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/annotated/abc.jpg?width=400&height=400&quality=60&resize=cover",
    );
  });

  it("falls back to the storage path when the annotation path is empty (grid, resize on)", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: "", storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&height=400&quality=60&resize=cover",
    );
  });
});

describe("photoUrl — full variant", () => {
  it("returns the original URL even when resize is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: null, storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
      "full",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/abc.jpg",
    );
  });
});

describe("originalPhotoUrl — the annotator always edits the un-annotated original", () => {
  it("returns the full-resolution original, ignoring any saved annotation", () => {
    // The annotator must re-open the ORIGINAL so it doesn't paint new strokes
    // on top of an already-annotated render. Even with a saved annotation, and
    // even with resize enabled, it gets the original object URL.
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = originalPhotoUrl(
      { annotated_path: "annotated/abc.jpg", storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/abc.jpg",
    );
  });
});

describe("reportCoverPhotoUrl — the PDF cover photo", () => {
  it("returns null when the job has no cover photo", () => {
    expect(reportCoverPhotoUrl(null, SUPABASE_URL)).toBeNull();
  });

  it("uses the annotated copy at full resolution when the cover is annotated", () => {
    // Resize on must not shrink the cover: reports stay print-quality.
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = reportCoverPhotoUrl(
      { annotated_path: "annotated/cover.jpg", storage_path: "originals/cover.jpg" },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/annotated/cover.jpg",
    );
  });

  it("falls back to the stored original when the cover has no annotation", () => {
    const url = reportCoverPhotoUrl(
      { annotated_path: null, storage_path: "originals/cover.jpg" },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/cover.jpg",
    );
  });
});

describe("photoUrl — unsupported format (grid, resize on)", () => {
  it("serves the original for a format the resizer can't transform (HEIC)", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: null, storage_path: "originals/img.heic" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/img.heic",
    );
  });

  it("still resizes when the extension is uppercase (cameras emit .JPG)", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = photoUrl(
      { annotated_path: null, storage_path: "originals/IMG_0042.JPG" },
      SUPABASE_URL,
      "grid",
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/IMG_0042.JPG?width=400&height=400&quality=60&resize=cover",
    );
  });
});
