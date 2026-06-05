import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCoverPhotoUrl } from "./cover-photo";

const SUPABASE_URL = "https://proj.supabase.co";

afterEach(() => vi.unstubAllEnvs());

// The two URL-asserting cases pin the resize flag OFF explicitly: they are
// the "no regression when transformation is disabled" guard (#420 acceptance),
// so they must not depend on ambient env — once the flag is flipped on at
// go-live (ADR 0008) an unpinned test would flip to the render URL and fail.
describe("resolveCoverPhotoUrl — cover with annotation, resize off", () => {
  it("prefers the annotated image over the original", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "");
    const url = resolveCoverPhotoUrl(
      {
        annotated_path: "annotated/abc.jpg",
        storage_path: "originals/abc.jpg",
      },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/annotated/abc.jpg",
    );
  });
});

describe("resolveCoverPhotoUrl — cover without annotation, resize off", () => {
  it("falls back to the original image when there is no annotation", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "");
    const url = resolveCoverPhotoUrl(
      {
        annotated_path: null,
        storage_path: "originals/abc.jpg",
      },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/photos/originals/abc.jpg",
    );
  });
});

describe("resolveCoverPhotoUrl — no cover set", () => {
  it("returns null when the job has no cover photo", () => {
    expect(resolveCoverPhotoUrl(null, SUPABASE_URL)).toBeNull();
  });
});

describe("resolveCoverPhotoUrl — cover photo row absent", () => {
  // The FK is ON DELETE SET NULL, so deleting the referenced photo nulls
  // cover_photo_id and the join yields no embedded row at all (undefined).
  it("returns null when the joined cover photo row is missing", () => {
    expect(resolveCoverPhotoUrl(undefined, SUPABASE_URL)).toBeNull();
  });
});

describe("resolveCoverPhotoUrl — resized preview (#420)", () => {
  // The cover thumbnail in the Comfortable rows and the squares in the cover
  // picker are small images that shouldn't pull multi-MB originals. Like the
  // Job Photos grid (#391, ADR 0008), the cover routes through the "grid"
  // variant: when image transformation is enabled it serves a resized preview.
  it("returns the resized grid preview when image transformation is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = resolveCoverPhotoUrl(
      { annotated_path: null, storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/originals/abc.jpg?width=400&quality=60&resize=cover",
    );
  });

  it("previews the resized annotated image when an annotated cover is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    const url = resolveCoverPhotoUrl(
      { annotated_path: "annotated/abc.jpg", storage_path: "originals/abc.jpg" },
      SUPABASE_URL,
    );
    expect(url).toBe(
      "https://proj.supabase.co/storage/v1/render/image/public/photos/annotated/abc.jpg?width=400&quality=60&resize=cover",
    );
  });
});
