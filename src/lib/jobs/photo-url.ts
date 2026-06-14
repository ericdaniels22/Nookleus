// The subset of a photo row the URL resolver reads.
export interface PhotoUrlSource {
  annotated_path: string | null;
  storage_path: string;
}

// Where the URL is used: the grid wants a small preview; the report PDF wants a
// print-sized-but-bounded render ("pdf" for the 2/3/4-up body photos, "cover"
// for the larger full-page hero); everywhere else (single-photo detail,
// annotator) wants the full-resolution original.
export type PhotoVariant = "grid" | "full" | "pdf" | "cover";

const PHOTOS_OBJECT_PREFIX = "/storage/v1/object/public/photos/";
const PHOTOS_RENDER_PREFIX = "/storage/v1/render/image/public/photos/";

// Grid-preview transform parameters (ADR 0008): a 400×400 square center-crop at
// moderate quality, matching the aspect-square grid tile. Both width AND height
// are required — `resize=cover` with only one dimension degenerates into a
// full-height center strip (e.g. 400×4032 for a 3024×4032 portrait), which the
// tile's CSS `object-cover` then zooms into hard (issue #596).
const GRID_PREVIEW_QUERY = "?width=400&height=400&quality=60&resize=cover";

// Report-PDF embed transform (#625; quality tuned down for emailability).
// @react-pdf
// embeds JPEGs as raw DCTDecode streams with no recompression, so the PDF's byte
// size is essentially the sum of its embedded JPEGs — a report of full-resolution
// iPhone originals (3–7 MB each) blows past Supabase Storage's 50 MB upload cap,
// and even a downscaled report can land ~14 MB, too large to email. A 1600px-wide
// render is sharp at the report's 2/3/4-per-page layout; quality 72 (down from
// 80) trims a further ~25–30% off each photo with no visible loss at that display
// size, keeping the download comfortably emailable. Width-only (no height/resize)
// scales the whole image down without cropping; the server-side re-encode also
// strips Apple HDR gain-map tails, so resized embeds never hit the jay-peg desync
// that blanks frames.
const PDF_EMBED_QUERY = "?width=1600&quality=72";

// Cover-photo embed transform. The cover is the report's full-page hero,
// so it gets more pixels than a 2/3/4-up body photo — 2000px wide keeps it crisp
// edge-to-edge — but it was previously embedded as the full-resolution original
// (the "full" variant), adding 3–7 MB of uncompressed JPEG to every report on its
// own. Routing it through a bounded render drops that to well under 1 MB while
// staying print-sharp, and (as a bonus) the re-encode strips any Apple HDR
// gain-map tail the original cover carried.
const COVER_EMBED_QUERY = "?width=2000&quality=80";

// Formats Supabase image transformation can resize. A Photo's stored file
// may be something the transformer rejects — a HEIC original from a web
// upload, or a short video — in which case we must serve it untouched rather
// than hand the grid a broken render URL.
const RESIZABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

function isResizable(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return RESIZABLE_EXTENSIONS.has(ext);
}

// Resizing requires Supabase Pro image transformation; until that is enabled
// the flag stays off and the grid serves originals (no worse than today).
function isResizeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PHOTO_RESIZE_ENABLED === "true";
}

/**
 * Resolve the public image URL for a job's Photo.
 *
 * The single place Photo grid/detail URLs are built (see ADR 0008). The
 * "grid" variant returns a small resized preview, "pdf" a print-sized (1600px)
 * body-photo render, and "cover" a larger (2000px) full-page hero render — each
 * when image transformation is enabled, otherwise the original; "full" always
 * returns the original.
 */
export function photoUrl(
  source: PhotoUrlSource,
  supabaseUrl: string,
  variant: PhotoVariant,
): string {
  const path = source.annotated_path || source.storage_path;
  if (variant === "grid" && isResizeEnabled() && isResizable(path)) {
    return `${supabaseUrl}${PHOTOS_RENDER_PREFIX}${path}${GRID_PREVIEW_QUERY}`;
  }
  if (variant === "pdf" && isResizeEnabled() && isResizable(path)) {
    return `${supabaseUrl}${PHOTOS_RENDER_PREFIX}${path}${PDF_EMBED_QUERY}`;
  }
  if (variant === "cover" && isResizeEnabled() && isResizable(path)) {
    return `${supabaseUrl}${PHOTOS_RENDER_PREFIX}${path}${COVER_EMBED_QUERY}`;
  }
  return `${supabaseUrl}${PHOTOS_OBJECT_PREFIX}${path}`;
}

/**
 * Resolve the full-resolution **original** image URL for a Photo, ignoring any
 * saved annotation.
 *
 * The annotator must re-open the un-annotated original so new strokes aren't
 * painted on top of an already-annotated render (double-rendering). Unlike the
 * "full" variant of {@link photoUrl} — which shows the annotated copy when one
 * exists — this always points at the stored original.
 */
export function originalPhotoUrl(
  source: PhotoUrlSource,
  supabaseUrl: string,
): string {
  return photoUrl(
    { annotated_path: null, storage_path: source.storage_path },
    supabaseUrl,
    "full",
  );
}

// A cover photo may not be set, and its paths arrive nullable from the report
// query — narrower than PhotoUrlSource.
export interface CoverPhotoSource {
  annotated_path: string | null;
  storage_path: string | null;
}

/**
 * Resolve the embed URL for a report's cover Photo, or `null` when the job has
 * no usable cover.
 *
 * Uses the "cover" variant of {@link photoUrl}: a bounded 2000px render when
 * image transformation is enabled (so the hero stays crisp without dragging the
 * full-resolution original's 3–7 MB into the PDF), falling back to the
 * original when transformation is off or the format is unresizable. It prefers
 * the annotated copy when present; but a job may have no cover photo at all (or
 * only empty paths), in which case the PDF must render its cover page without a
 * photo rather than point at a broken URL.
 */
export function reportCoverPhotoUrl(
  cover: CoverPhotoSource | null,
  supabaseUrl: string,
): string | null {
  const path = cover?.annotated_path || cover?.storage_path;
  if (!path) return null;
  return photoUrl({ annotated_path: null, storage_path: path }, supabaseUrl, "cover");
}
