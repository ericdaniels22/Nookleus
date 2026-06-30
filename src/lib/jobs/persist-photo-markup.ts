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
 * `persistAnnotatedRender`, rebuilt on leave/close). Find the existing row by
 * photo_id and update it in place, or insert a fresh one. A write error is
 * thrown so the caller's auto-save loop can retry it with backoff.
 */
export async function persistPhotoMarkup(
  supabase: PhotoMarkupStore,
  args: PersistMarkupArgs,
): Promise<void> {
  const { data: existing } = await supabase
    .from("photo_annotations")
    .select("id")
    .eq("photo_id", args.photoId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("photo_annotations")
      .update({ annotation_data: args.annotationData })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("photo_annotations").insert({
      organization_id: args.organizationId,
      photo_id: args.photoId,
      annotation_data: args.annotationData,
      created_by: await args.resolveAuthor(),
    });
    if (error) throw error;
  }
}
