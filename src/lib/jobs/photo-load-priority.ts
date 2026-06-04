// How aggressively a grid Photo image should load. These are the two HTML
// image-loading levers a plain <img> exposes (Next.js 16 deprecated the
// next/image `priority` prop): eager + fetchPriority "high" makes the browser
// fetch immediately at the front of the queue; lazy + "auto" defers until the
// image nears the viewport.
export interface PhotoLoadPriority {
  loading: "eager" | "lazy";
  fetchPriority: "high" | "auto";
}

const EAGER: PhotoLoadPriority = { loading: "eager", fetchPriority: "high" };
const LAZY: PhotoLoadPriority = { loading: "lazy", fetchPriority: "auto" };

/**
 * Decide how a Job Photos grid image should load, given its position.
 *
 * Top-first loading (#391 / ADR 0008): the first row is what the user sees on
 * arrival, so those images load eagerly at high priority and paint
 * immediately; everything below stays lazy, so a Job with hundreds of Photos
 * doesn't flood the network and the lower rows defer until scrolled into view.
 *
 * The first row is the first `columnsPerRow` images — indices
 * `0 … columnsPerRow - 1`. The boundary is exact: `index === columnsPerRow`
 * is already the first image of the second row, hence lazy. Passing
 * `columnsPerRow = 0` makes every image lazy, which is how the grid marks the
 * date groups below the top one (only the newest group has a visible top row).
 */
export function photoLoadPriority(
  index: number,
  columnsPerRow: number,
): PhotoLoadPriority {
  return index < columnsPerRow ? EAGER : LAZY;
}
