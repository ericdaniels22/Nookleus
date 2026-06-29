import { createClient } from "@/lib/supabase";
import { buildAnnotatedPath } from "@/lib/jobs/annotated-path";

/** The subset of the Supabase client this function uses. The real client
 *  (ReturnType<typeof createClient>) is assignable to it, so the call site is
 *  fully typechecked; a structural mock satisfies it in tests. */
type AnnotatedRenderStore = ReturnType<typeof createClient>;

interface PersistArgs {
  photoId: string;
  storagePath: string;
  /** The row's current annotated_path, captured BEFORE this save. */
  previousAnnotatedPath: string | null | undefined;
  blob: Blob;
  /** Unique per save (e.g. Date.now().toString(36)) — cache-busts the CDN. */
  token: string;
}

/**
 * Upload a flattened annotated PNG to a UNIQUE path, point the photos row at it,
 * then best-effort delete the prior render — but ONLY after confirming the row
 * update succeeded. A unique path per save is a guaranteed CDN cache miss (Storage
 * keys its cache by path). Deleting only on update success keeps the row from ever
 * pointing at a file we removed; a failed delete is harmless (leaves an orphan,
 * never a stale render).
 */
export async function persistAnnotatedRender(
  supabase: AnnotatedRenderStore,
  args: PersistArgs,
): Promise<{ annotatedPath: string }> {
  const annotatedPath = buildAnnotatedPath(args.storagePath, args.token);

  await supabase.storage.from("photos").upload(annotatedPath, args.blob, {
    upsert: true,
    contentType: "image/png",
  });

  const { error: updateError } = await supabase
    .from("photos")
    .update({ annotated_path: annotatedPath })
    .eq("id", args.photoId);

  if (
    !updateError &&
    args.previousAnnotatedPath &&
    args.previousAnnotatedPath !== annotatedPath
  ) {
    try {
      await supabase.storage
        .from("photos")
        .remove([args.previousAnnotatedPath]);
    } catch (err) {
      console.warn("Could not delete previous annotated render:", err);
    }
  }

  return { annotatedPath };
}
