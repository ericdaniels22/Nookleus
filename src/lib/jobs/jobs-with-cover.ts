import type { SupabaseClient } from "@supabase/supabase-js";

import type { Job, Photo } from "@/lib/types";
import { openStageKeys } from "./build-job-sections";

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

/** Group a flat `{ job_id }` row list into a per-job occurrence count. */
function tallyByJob(rows: Array<{ job_id: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { job_id } of rows) {
    counts.set(job_id, (counts.get(job_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Tally how many photos and files each job owns and attach the two
 * counts to their jobs. The count rows arrive as flat `{ job_id }` lists
 * — one row per photo / per file — so a job with none simply has no rows
 * and lands on a count of 0, never `undefined`. Photo and file tallies
 * are kept on separate keys so neither overwrites the other.
 */
export function attachJobCounts(
  jobs: Job[],
  photoRows: Array<{ job_id: string }>,
  fileRows: Array<{ job_id: string }>,
): Job[] {
  const photoCounts = tallyByJob(photoRows);
  const fileCounts = tallyByJob(fileRows);
  return jobs.map((job) => ({
    ...job,
    photo_count: photoCounts.get(job.id) ?? 0,
    file_count: fileCounts.get(job.id) ?? 0,
  }));
}

/**
 * Load every non-deleted job together with its cover photo, plus a photo
 * count and a file count per job. The cover is joined through
 * `jobs.cover_photo_id` in the jobs query itself; the two counts come
 * from one batched read of `photos` and one of `job_files`, each scoped
 * to the loaded jobs — so the whole load is three queries regardless of
 * how many jobs there are, never one per job. Rows come back newest-
 * first; an optional filter narrows them to emergencies or one status,
 * mirroring the Jobs tab's filter pills. Returns `[]` if the jobs query
 * fails.
 *
 * The default ("all") view defers Closed & Lost: it scopes the fetch to the
 * live stages so the page doesn't pay to load dead jobs until the "show Closed
 * & Lost" toggle reveals them (`includeClosedLost`, #728). An explicit stage or
 * emergency filter is unaffected — picking the Closed/Lost pill still fetches
 * that stage directly.
 */
export async function loadJobsWithCover(
  supabase: SupabaseClient,
  filter: string = "all",
  { includeClosedLost = false }: { includeClosedLost?: boolean } = {},
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
  } else if (!includeClosedLost) {
    // Default "all" view defers Closed & Lost — scope to the live stages so the
    // page doesn't pay to fetch dead jobs until the toggle reveals them (#728).
    query = query.in("status", openStageKeys());
  }

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });
  if (error || !data) return [];
  const jobs = (data as Array<{ cover_photo?: Photo | Photo[] | null }>).map(
    (row) => shapeJobWithCover(row),
  ) as Job[];
  if (jobs.length === 0) return jobs;

  // Two batched aggregate reads, each grouped by job by attachJobCounts:
  // one row per photo / per file, scoped to exactly the loaded jobs.
  const jobIds = jobs.map((job) => job.id);
  const [photoRes, fileRes] = await Promise.all([
    supabase.from("photos").select("job_id").in("job_id", jobIds),
    supabase.from("job_files").select("job_id").in("job_id", jobIds),
  ]);
  return attachJobCounts(
    jobs,
    (photoRes.data ?? []) as Array<{ job_id: string }>,
    (fileRes.data ?? []) as Array<{ job_id: string }>,
  );
}
