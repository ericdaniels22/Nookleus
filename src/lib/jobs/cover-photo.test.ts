import { describe, it, expect } from "vitest";
import { resolveCoverPhotoUrl } from "./cover-photo";

const SUPABASE_URL = "https://proj.supabase.co";

describe("resolveCoverPhotoUrl — cover with annotation", () => {
  it("prefers the annotated image over the original", () => {
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

describe("resolveCoverPhotoUrl — cover without annotation", () => {
  it("falls back to the original image when there is no annotation", () => {
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
