// The subset of a photo row the URL resolver reads.
export interface PhotoUrlSource {
  annotated_path: string | null;
  storage_path: string;
}

// Where the URL is used: the grid wants a small preview; everywhere else
// (single-photo detail, annotator, PDF) wants the full-resolution original.
export type PhotoVariant = "grid" | "full";

const PHOTOS_OBJECT_PREFIX = "/storage/v1/object/public/photos/";
const PHOTOS_RENDER_PREFIX = "/storage/v1/render/image/public/photos/";

// Grid-preview transform parameters. Sensible starting point per ADR 0008
// (~grid-square width, moderate quality, square crop); tune at go-live.
const GRID_PREVIEW_QUERY = "?width=400&quality=60&resize=cover";

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
 * "grid" variant returns a small resized preview when image transformation
 * is enabled, otherwise the original; "full" always returns the original.
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
  return `${supabaseUrl}${PHOTOS_OBJECT_PREFIX}${path}`;
}
