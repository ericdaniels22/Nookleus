import { describe, it, expect, vi, afterEach } from "vitest";
import { photoUrl } from "./photo-url";

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
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&quality=60&resize=cover",
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
      "https://proj.supabase.co/storage/v1/render/image/public/photos/annotated/abc.jpg?width=400&quality=60&resize=cover",
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
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&quality=60&resize=cover",
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
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/IMG_0042.JPG?width=400&quality=60&resize=cover",
    );
  });
});
