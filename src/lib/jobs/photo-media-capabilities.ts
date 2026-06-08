// Issue #516 / #517 — the pure rule for which viewer capabilities apply to a
// Photo, plus the URL its media element loads.
//
// Zoom and Draw act on a still raster image: zoom magnifies it, Draw hands off
// to the Annotator to paint on it. A video has neither — it plays inline with a
// scrub bar instead — so the viewer hides those controls for video (PRD #511,
// user story 33). The photo-vs-video decision is `photos.media_type` and
// nothing more. The `source` is the URL the viewer loads — the <img> src for a
// still, the <video> src for a clip — resolved through photoUrl so URL-building
// stays in its one place (ADR 0008). Kept free of React/DOM so the rule lives
// in one tested place.

import type { Photo } from "@/lib/types";
import { photoUrl, type PhotoUrlSource } from "./photo-url";

export interface MediaCapabilities {
  /** Pinch / scroll / pan / double-tap magnification applies. */
  canZoom: boolean;
  /** The Edit handoff to the Annotator (drawing) applies. */
  canDraw: boolean;
  /** This Photo is a video (plays inline) rather than a still image. */
  isVideo: boolean;
  /** The URL the media element loads: <img> src for a still, <video> src for a clip. */
  source: string;
}

/** Which viewer capabilities apply to `photo`, and the URL its media loads. */
export function mediaCapabilities(
  photo: Pick<Photo, "media_type"> & PhotoUrlSource,
  supabaseUrl: string,
): MediaCapabilities {
  const isVideo = photo.media_type === "video";
  return {
    canZoom: !isVideo,
    canDraw: !isVideo,
    isVideo,
    source: photoUrl(photo, supabaseUrl, "full"),
  };
}
