// Issue #518 — the pure rule for which version of a Photo an export acts on
// (the displayed image: annotated when drawings exist, else the original) and
// what the exported file is named. Free of React/DOM so the version + filename
// choice is verified in one place; the viewer's Share / Save to device entries
// and the platform share/download plumbing read this.

import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/types";
import { exportVersion } from "./photo-export-version";
import { photoUrl } from "./photo-url";

const SUPABASE_URL = "https://example.supabase.co";

// A Photo with the fields the export rule reads: the two paths (to pick the
// displayed version + its extension) and the caption (for a friendly filename).
function photo(over: Partial<Photo> = {}): Photo {
  return {
    id: "p1",
    organization_id: "org-1",
    job_id: "job-1",
    storage_path: "job-1/IMG_1234.jpg",
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "Eric",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-01T00:00:00Z",
    uploaded_from: "web",
    client_capture_id: null,
    ...over,
  };
}

describe("exportVersion — share acts on the displayed original when undrawn", () => {
  it("resolves the original's full URL and a caption-based filename", () => {
    const p = photo({ caption: "Kitchen before" });
    const result = exportVersion(p, SUPABASE_URL, "share");

    // The displayed version of an un-annotated Photo is its original, resolved
    // through the one place Photo URLs are built (ADR 0008).
    expect(result.url).toBe(photoUrl(p, SUPABASE_URL, "full"));
    // Friendly name from the caption; extension matches the exported file.
    expect(result.filename).toBe("Kitchen before.jpg");
  });
});

describe("exportVersion — share acts on the annotated render when drawn on", () => {
  it("resolves the annotated URL and an extension matching that render", () => {
    const p = photo({
      caption: "Kitchen before",
      annotated_path: "job-1/IMG_1234-annotated.png",
    });
    const result = exportVersion(p, SUPABASE_URL, "share");

    // The displayed version is now the annotated copy.
    expect(result.url).toBe(photoUrl(p, SUPABASE_URL, "full"));
    // The render is a PNG even though the original was a JPG — the extension
    // must follow the exported version, not the stored original.
    expect(result.filename).toBe("Kitchen before.png");
  });
});

describe("exportVersion — names the file from the original when there is no caption", () => {
  it("uses the original's basename (without its extension) as the stem", () => {
    const p = photo({ caption: null, storage_path: "job-1/IMG_1234.jpg" });
    const result = exportVersion(p, SUPABASE_URL, "share");

    expect(result.filename).toBe("IMG_1234.jpg");
  });

  it("keeps the original's name even when it has been drawn on", () => {
    // No caption + an annotation: the stem is still the original's name, while
    // the extension is the render's (.png).
    const p = photo({
      caption: null,
      storage_path: "job-1/IMG_1234.jpg",
      annotated_path: "job-1/IMG_1234-annotated.png",
    });

    expect(exportVersion(p, SUPABASE_URL, "share").filename).toBe(
      "IMG_1234.png",
    );
  });
});

describe("exportVersion — sanitizes the caption into a safe filename", () => {
  it("replaces path-illegal characters in the caption", () => {
    const p = photo({ caption: "Before/After: roof" });

    expect(exportVersion(p, SUPABASE_URL, "share").filename).toBe(
      "Before_After_ roof.jpg",
    );
  });
});

describe("exportVersion — save and share act on the same displayed version", () => {
  it("returns the same url and filename for save as for share", () => {
    const p = photo({
      caption: "Kitchen before",
      annotated_path: "job-1/IMG_1234-annotated.png",
    });

    expect(exportVersion(p, SUPABASE_URL, "save")).toEqual(
      exportVersion(p, SUPABASE_URL, "share"),
    );
  });
});

describe("exportVersion — duplicate marks the copy in its filename", () => {
  it("appends 'copy' to the stem so a duplicate doesn't shadow the original", () => {
    const p = photo({ caption: "Kitchen before" });
    const result = exportVersion(p, SUPABASE_URL, "duplicate");

    // Same displayed version, but a distinct name.
    expect(result.url).toBe(photoUrl(p, SUPABASE_URL, "full"));
    expect(result.filename).toBe("Kitchen before copy.jpg");
  });
});
