/** The validated set of photos-per-page layout values a report body can use. */
export type PhotosPerPage = 1 | 2 | 4;

const DEFAULT_PHOTOS_PER_PAGE: PhotosPerPage = 2;

/**
 * The slice of Company Settings that carries the company-wide photos-per-page
 * value. Company Settings are key/value rows, so the value arrives as a string
 * ("1" | "2" | "4"); it is typed loosely here to tolerate a numeric value too.
 */
export interface PhotosPerPageSettings {
  report_photos_per_page?: string | number | null;
}

/**
 * Resolve the company-wide photos-per-page layout value from Company Settings.
 *
 * This is the single place the stored `report_photos_per_page` value is parsed
 * and validated, containing the string-to-number boundary in one tested
 * function. Missing, empty, or out-of-range values fall back to 2.
 */
export function resolvePhotosPerPage(
  settings: PhotosPerPageSettings | null | undefined,
): PhotosPerPage {
  const parsed = Number(settings?.report_photos_per_page);
  if (parsed === 1 || parsed === 2 || parsed === 4) {
    return parsed;
  }
  return DEFAULT_PHOTOS_PER_PAGE;
}
