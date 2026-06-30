import { createClient } from "@/lib/supabase";
import type { AnnotationData } from "@/lib/jobs/photo-annotation-format";

/** The subset of the Supabase client this function uses. The real client
 *  (ReturnType<typeof createClient>) is assignable to it, so the call site is
 *  fully typechecked; a structural mock satisfies it in tests. */
type PhotoMarkupStore = ReturnType<typeof createClient>;

interface PersistMarkupArgs {
  photoId: string;
  /** The active org, stamped onto a freshly inserted row. */
  organizationId: string | null;
  /** The serialized markup envelope (format 3) — the CHEAP half of the split. */
  annotationData: AnnotationData;
  /** Resolves the author for a FIRST-TIME annotation (issue #808): the
   *  signed-in user's name/email/"unknown", matching photos.taken_by. Invoked
   *  lazily, ONLY on the insert branch — a re-save updates annotation_data in
   *  place and must never overwrite the original author, and the debounced
   *  auto-save shouldn't fire an auth round-trip on every edit. */
  resolveAuthor: () => Promise<string>;
}

/**
 * Upsert ONLY a photo's editable markup (the `photo_annotations.annotation_data`
 * blob). This is the cheap, debounced half of the ADR 0024 split write — it
 * never touches Storage or `photos.annotated_path` (that flattened render is
 * `persistAnnotatedRender`, rebuilt on leave/close). A write error is thrown so
 * the caller's auto-save loop can retry it with backoff.
 *
 * One canonical row per Photo is guaranteed by the `UNIQUE(photo_id)` index
 * (issue #848), which lets us drop the old read-then-write window:
 *
 *  - Re-save (the common, debounced path): UPDATE the row in place, matched by
 *    its unique `photo_id`. Carrying only `annotation_data` preserves the
 *    original `created_by` and skips the author round-trip (#808) — and because
 *    load and save now resolve the very same row, an edit can never land on a
 *    row the loader won't read back.
 *  - First-time save (UPDATE touched no row): insert via `upsert(...,
 *    { onConflict: 'photo_id' })`. If a concurrent first save raced us and
 *    inserted first, the UNIQUE constraint routes ours to the ON CONFLICT
 *    branch — a no-op-ish update instead of a 23505 — so both writers converge
 *    onto the one row. (That conflict branch is the only path that can rewrite
 *    `created_by`; it's an acceptable tie-break between two legitimate
 *    first-time authors, and the steady-state re-save above never reaches it.)
 */
export async function persistPhotoMarkup(
  supabase: PhotoMarkupStore,
  args: PersistMarkupArgs,
): Promise<void> {
  // `.select("id")` makes the UPDATE return the rows it touched, so an empty
  // result is the unambiguous signal that no canonical row exists yet.
  const { data: updated, error: updateError } = await supabase
    .from("photo_annotations")
    .update({ annotation_data: args.annotationData })
    .eq("photo_id", args.photoId)
    .select("id");
  if (updateError) throw updateError;
  if (updated && updated.length > 0) return;

  const { error: upsertError } = await supabase
    .from("photo_annotations")
    .upsert(
      {
        organization_id: args.organizationId,
        photo_id: args.photoId,
        annotation_data: args.annotationData,
        created_by: await args.resolveAuthor(),
      },
      { onConflict: "photo_id" },
    );
  if (upsertError) throw upsertError;
}
