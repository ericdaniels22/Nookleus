// Issue #516 — the pure rule for which viewer capabilities apply to a Photo.
// Zoom and Draw operate on a still raster image; a video has neither (it plays
// instead). Derived from `photos.media_type`, free of React/DOM so the
// photo-vs-video decision is verified in one place. The viewer reads these
// flags to hide the Zoom controls and the Edit (Draw) handoff where they don't
// apply (PRD #511, user story 33).

import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/types";
import { mediaCapabilities } from "./photo-media-capabilities";

// A Photo with only the field the capabilities rule reads (media_type).
function photo(mediaType: Photo["media_type"]): Photo {
  return {
    id: "p1",
    organization_id: "org-1",
    job_id: "job-1",
    storage_path: "job-1/p1.jpg",
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "Eric",
    media_type: mediaType,
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-01T00:00:00Z",
    uploaded_from: "web",
    client_capture_id: null,
  };
}

describe("mediaCapabilities — a still Photo supports Zoom and Draw", () => {
  it("reports canZoom and canDraw for a photo", () => {
    const caps = mediaCapabilities(photo("photo"));

    expect(caps.canZoom).toBe(true);
    expect(caps.canDraw).toBe(true);
    expect(caps.isVideo).toBe(false);
  });
});

describe("mediaCapabilities — a video plays, so Zoom and Draw don't apply", () => {
  it("hides canZoom and canDraw for a video", () => {
    const caps = mediaCapabilities(photo("video"));

    expect(caps.canZoom).toBe(false);
    expect(caps.canDraw).toBe(false);
    expect(caps.isVideo).toBe(true);
  });
});
