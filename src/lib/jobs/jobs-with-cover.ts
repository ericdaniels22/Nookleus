import type { SupabaseClient } from "@supabase/supabase-js";

import type { Job, Photo } from "@/lib/types";

/**
 * Normalize a raw jobs row so its joined cover photo is a single object,
 * or `null` when the job has no cover set. A PostgREST to-one embed can
 * arrive as either an object or a one-element array; this collapses both.
 * Never auto-picks a cover — a job with no `cover_photo_id` stays null.
 */
export function shapeJobWithCover<
  T extends { cover_photo?: Photo | Photo[] | null },
>(raw: T): Omit<T, "cover_photo"> & { cover_photo: Photo | null } {
  const embed = raw.cover_photo;
  const cover_photo = Array.isArray(embed)
    ? (embed[0] ?? null)
    : (embed ?? null);
  return { ...raw, cover_photo };
}

/**
 * Load every non-deleted job together with its cover photo in a single
 * batched query. The cover is joined through `jobs.cover_photo_id`, so
 * there is no per-job follow-up query. Rows come back newest-first; an
 * optional filter narrows them to emergencies or one status, mirroring
 * the Jobs tab's filter pills. Returns `[]` if the query fails.
 */
export async function loadJobsWithCover(
  supabase: SupabaseClient,
  filter: string = "all",
): Promise<Job[]> {
  let query = supabase
    .from("jobs")
    .select(
      "*, contact:contacts!contact_id(*), cover_photo:photos!cover_photo_id(*)",
    )
    .is("deleted_at", null);

  if (filter === "emergency") {
    query = query.eq("urgency", "emergency");
  } else if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error || !data) return [];
  return (data as Array<{ cover_photo?: Photo | Photo[] | null }>).map((row) =>
    shapeJobWithCover(row),
  ) as Job[];
}
