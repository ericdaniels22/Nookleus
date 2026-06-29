// #613 — Showcase: entity + builder (drafts).
//
// A Showcase tells one Job's story with a hand-picked, ordered set of that
// Job's Photos. `sanitizeShowcasePhotoSelection` is the single pure place that
// reconciles a *requested* selection against the Job's *actual* Photos: it is
// the integrity gate the create/save route runs before persisting `photo_ids`.
// Mirrors `ownedJobPhotoIds` in photo-reports.ts (the caller fetches the Job's
// photo ids; this decides what survives), kept pure so it is trivially tested.

/**
 * The showcase photo selection to persist, given the Job's own photo ids and
 * the ids the client requested.
 *
 * Keeps only ids that belong to the Job and preserves the requested order (the
 * gallery order is meaningful). Foreign ids are dropped, and a photo appears at
 * most once — a duplicate keeps the position it was first chosen.
 */
export function sanitizeShowcasePhotoSelection(
  jobPhotoIds: string[],
  requestedIds: string[],
): string[] {
  const owned = new Set(jobPhotoIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of requestedIds) {
    if (!owned.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
