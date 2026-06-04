import { photoUrl, type PhotoUrlSource } from "./photo-url";

/**
 * Pick the grid-preview URLs to warm in the background when a Job opens.
 *
 * Background preload (#395 / ADR 0008): the Job page already holds the newest
 * Photo rows it loaded for the header/summary, so on open we can quietly
 * prefetch their previews — then tapping the Photos tab paints instantly
 * instead of starting to load on tap.
 *
 * The list is **capped at `screenful`** so a user who opens a Job but never
 * taps Photos wastes little data: we warm only what a first screen would show,
 * never the whole (possibly hundreds-deep) library. A Job with fewer rows than
 * a screenful returns just those; an empty Job returns `[]`.
 *
 * URLs come from the resolver's `"grid"` variant — the same small resized
 * previews the grid `<img>` renders (see {@link photoUrl}) — so the prefetched
 * request and the grid's request share a cache key and the warm hit lands.
 * `photos` is expected newest-first (the order the page loaded them), and the
 * returned URLs preserve that order.
 */
export function pickPreloadUrls(
  photos: PhotoUrlSource[],
  supabaseUrl: string,
  screenful: number,
): string[] {
  return photos
    .slice(0, screenful)
    .map((photo) => photoUrl(photo, supabaseUrl, "grid"));
}
