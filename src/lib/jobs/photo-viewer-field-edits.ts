import type { Photo } from "@/lib/types";

// Issue #847 — the Photo viewer navigates a frozen snapshot of the grid's
// Photos (#515): the list is captured when a Photo is opened and never
// refreshed, even though auto-save (#806) refreshes the grid behind it. The
// viewer's seed effect re-seeds the editable caption / Before-After fields from
// that snapshot every time you page to a Photo, so paging away and back to a
// just-edited Photo would re-seed it from stale data and silently revert the
// edit.
//
// This overlay is the viewer's memory of the edits it made this session, keyed
// by Photo id. The seed effect prefers it over the snapshot, so re-seeding can
// never clobber a change the user just made. (Assigned tags don't need this —
// they're re-fetched per Photo.)

/**
 * The fields the viewer can edit in-place, captured per Photo. A key is present
 * only once that field has been edited this session; an absent key means "fall
 * back to the snapshot". `caption` is stored as the raw input string (""
 * included); `role` includes a deliberate clear to `null`.
 */
export interface ViewerFieldEdit {
  caption?: string;
  role?: Photo["before_after_role"];
}

/** Per-Photo overlay of this session's edits, keyed by Photo id. */
export type ViewerFieldEdits = Map<string, ViewerFieldEdit>;

/** Record the caption the user just typed for `photoId`. */
export function rememberCaption(
  edits: ViewerFieldEdits,
  photoId: string,
  caption: string,
): void {
  edits.set(photoId, { ...edits.get(photoId), caption });
}

/**
 * The caption to seed for `photo`: this session's edit if one was made
 * (including an edit back to an empty string), else the snapshot's caption,
 * normalized to "" for the controlled input.
 */
export function seedCaption(edits: ViewerFieldEdits, photo: Photo): string {
  const edit = edits.get(photo.id);
  if (edit && edit.caption !== undefined) return edit.caption;
  return photo.caption || "";
}

/** Record the Before-After role the user just chose for `photoId` (incl. null). */
export function rememberRole(
  edits: ViewerFieldEdits,
  photoId: string,
  role: Photo["before_after_role"],
): void {
  edits.set(photoId, { ...edits.get(photoId), role });
}

/**
 * The Before-After role to seed for `photo`: this session's edit if one was
 * made (including a deliberate clear to `null`), else the snapshot's role. We
 * test `"role" in edit` rather than `!== undefined` so a stored `null` (role
 * cleared) is honored instead of falling through to the stale snapshot.
 */
export function seedRole(
  edits: ViewerFieldEdits,
  photo: Photo,
): Photo["before_after_role"] {
  const edit = edits.get(photo.id);
  if (edit && "role" in edit) return edit.role ?? null;
  return photo.before_after_role;
}
