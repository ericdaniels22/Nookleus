// Issue #516 — the pure rule for which viewer capabilities apply to a Photo.
//
// Zoom and Draw act on a still raster image: zoom magnifies it, Draw hands off
// to the Annotator to paint on it. A video has neither — it plays inline with a
// scrub bar instead — so the viewer hides those controls for video (PRD #511,
// user story 33). The decision is `photos.media_type` and nothing more, kept
// here free of React/DOM so the photo-vs-video rule lives in one tested place.

import type { Photo } from "@/lib/types";

export interface MediaCapabilities {
  /** Pinch / scroll / pan / double-tap magnification applies. */
  canZoom: boolean;
  /** The Edit handoff to the Annotator (drawing) applies. */
  canDraw: boolean;
  /** This Photo is a video (plays inline) rather than a still image. */
  isVideo: boolean;
}

/** Which viewer capabilities apply to `photo`, off its `media_type`. */
export function mediaCapabilities(photo: Pick<Photo, "media_type">): MediaCapabilities {
  const isVideo = photo.media_type === "video";
  return { canZoom: !isVideo, canDraw: !isVideo, isVideo };
}
