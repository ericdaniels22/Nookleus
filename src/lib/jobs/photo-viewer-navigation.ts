// The pure navigation model behind the full-screen Photo viewer (#515).
//
// The viewer lets the user move through the Job's Photos — prev/next arrows,
// swipe, and arrow keys — and deleting one advances to the next. All of that
// ordering and index math lives here, free of React and the DOM, so it can be
// verified without rendering. The viewer component is the thin shell that wires
// these decisions to buttons, key handlers, touch events, and the toast.

import type { Photo } from "@/lib/types";

/**
 * Order a Job's Photos for the viewer: newest-first and **continuous**.
 *
 * The grid groups Photos under date dividers, but those dividers are display
 * context, not navigation stops — the viewer walks one flat newest-first run
 * straight across them. Ordering here (rather than trusting the caller) keeps
 * the viewer independent of however its Photos arrived. The sort is stable, so
 * Photos sharing a timestamp keep their incoming order.
 */
export function orderPhotosForViewer(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

// In the ordered list, index 0 is the newest Photo and higher indices are
// older. "Next" walks toward older Photos (the on-screen right arrow), "prev"
// toward newer (the left arrow). Both clamp at the ends — there is no wrap.

/** The index after stepping toward older Photos, clamped at the last one. */
export function nextPhotoIndex(index: number, count: number): number {
  return Math.min(index + 1, count - 1);
}

/** The index after stepping toward newer Photos, clamped at the first one. */
export function prevPhotoIndex(index: number): number {
  return Math.max(index - 1, 0);
}

/** Whether an older Photo exists to step to (drives the next arrow). */
export function hasNext(index: number, count: number): boolean {
  return index < count - 1;
}

/** Whether a newer Photo exists to step to (drives the prev arrow). */
export function hasPrev(index: number): boolean {
  return index > 0;
}

/** What the viewer should do after the Photo at `index` is deleted. */
export interface DeleteOutcome {
  /** True only when the last remaining Photo was removed — close the viewer. */
  close: boolean;
  /** The index to show next when not closing. */
  index: number;
}

/**
 * Decide where the viewer lands after deleting the Photo at `index`.
 *
 * `count` is the number of Photos before removal. Deleting advances to the
 * next (older) Photo, which — because the rest shift up — means staying at the
 * same index. Deleting the oldest Photo clamps back to the new last one, and
 * deleting the only Photo closes the viewer.
 */
export function indexAfterDelete(index: number, count: number): DeleteOutcome {
  const remaining = count - 1;
  if (remaining <= 0) return { close: true, index: 0 };
  return { close: false, index: Math.min(index, remaining - 1) };
}
