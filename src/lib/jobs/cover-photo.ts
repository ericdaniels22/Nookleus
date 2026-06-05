import { photoUrl } from "./photo-url";

// The subset of a photo row the cover-photo resolver reads.
export interface CoverPhotoSource {
  annotated_path: string | null;
  storage_path: string;
}

/**
 * Resolve the preview image URL for a job's cover photo.
 *
 * Given the job's joined cover-photo row, returns the URL to display in the
 * cover thumbnail (Jobs tab Comfortable rows) and the cover-picker grid —
 * both small squares that shouldn't download multi-MB originals. Delegates to
 * the shared {@link photoUrl} resolver's "grid" variant (ADR 0008), so the
 * cover gets a resized preview when image transformation is enabled and the
 * untouched original when it is off (no regression). Prefers the annotated
 * image over the original. Returns null when the job has no cover — either
 * none was ever set (cover_photo_id IS NULL), or the referenced photo was
 * deleted (the FK is ON DELETE SET NULL, so the join yields no row). The app
 * never auto-selects a cover.
 */
export function resolveCoverPhotoUrl(
  coverPhoto: CoverPhotoSource | null | undefined,
  supabaseUrl: string,
): string | null {
  if (!coverPhoto) return null;
  return photoUrl(coverPhoto, supabaseUrl, "grid");
}
