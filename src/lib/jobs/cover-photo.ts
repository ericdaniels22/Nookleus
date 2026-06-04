// The subset of a photo row the cover-photo resolver reads.
export interface CoverPhotoSource {
  annotated_path: string | null;
  storage_path: string;
}

const PHOTOS_BUCKET_PREFIX = "/storage/v1/object/public/photos/";

/**
 * Resolve the public image URL for a job's cover photo.
 *
 * Given the job's joined cover-photo row, returns the URL to display,
 * preferring the annotated image and falling back to the original
 * full-size image. Returns null when the job has no cover — either none
 * was ever set (cover_photo_id IS NULL), or the referenced photo was
 * deleted (the FK is ON DELETE SET NULL, so the join yields no row). The
 * app never auto-selects a cover.
 */
export function resolveCoverPhotoUrl(
  coverPhoto: CoverPhotoSource | null | undefined,
  supabaseUrl: string,
): string | null {
  if (!coverPhoto) return null;
  const path = coverPhoto.annotated_path ?? coverPhoto.storage_path;
  return `${supabaseUrl}${PHOTOS_BUCKET_PREFIX}${path}`;
}
