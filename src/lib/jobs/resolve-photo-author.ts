import { createClient } from "@/lib/supabase";

/** The subset of the Supabase client this function uses. The real client
 *  (ReturnType<typeof createClient>) is assignable to it, so the call site is
 *  fully typechecked; a structural mock satisfies it in tests. */
type AuthoringClient = ReturnType<typeof createClient>;

/**
 * Resolve a human-readable author for a Photo or its Annotations from the
 * signed-in user: their `user_profiles.full_name`, falling back to the account
 * email, then the literal `"unknown"`. This is the single source of truth for
 * "who did this" across the photo surfaces — the upload modal stamps
 * `photos.taken_by` with it and the annotator stamps
 * `photo_annotations.created_by` with it (issue #808), so the two always agree.
 */
export async function resolvePhotoAuthor(
  supabase: AuthoringClient,
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "unknown";

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.full_name || user.email || "unknown";
}
