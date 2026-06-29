// #613 — Showcase: entity + builder (drafts).
//
// The server-side create step for a Job's Showcase. The Job detail's "Create
// showcase" action POSTs here (via the route that wraps this in an admin-only
// Request Context); this function owns the data work so it can be tested against
// a fake Supabase client without an HTTP layer:
//
//   - sanitize the client-supplied photo selection down to the Job's own photos
//     (deduped, in the chosen order) via the pure sanitizeShowcasePhotoSelection
//     gate — the same trust-nothing posture as photo-reports' ownedJobPhotoIds,
//   - stamp `created_by` with the author, and
//   - insert the one draft Showcase row, scoped to the Organization and Job.
//
// One per Job: the partial unique index showcases_one_live_per_job (migration
// 613) lets a Job hold at most one LIVE Showcase. Unlike photo-report numbering
// — where a unique_violation is a recoverable race we retry — here it means the
// Job genuinely already has a Showcase, so we surface it as a typed conflict the
// route maps to 409 (the admin deletes the existing one to start over).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Showcase } from "@/lib/types";
import { sanitizeShowcasePhotoSelection } from "./showcase-photos";

/** Postgres SQLSTATE for unique_violation, surfaced via PostgREST's error code. */
const UNIQUE_VIOLATION = "23505";

/**
 * Thrown when a Job already has a LIVE Showcase (the one-live-per-Job index
 * rejected the insert). The route catches this to answer 409 rather than 500.
 */
export class ShowcaseAlreadyExistsError extends Error {
  constructor(message = "This Job already has a Showcase") {
    super(message);
    this.name = "ShowcaseAlreadyExistsError";
  }
}

export interface CreateShowcaseDraftInput {
  organizationId: string;
  jobId: string;
  /** Author stored into `created_by`; null when unknown (survives the gap). */
  createdBy: string | null;
  /** Optional title; defaults to "" (the admin names it in the builder). */
  title?: string;
  /** Optional write-up; defaults to "". */
  writeUp?: string;
  /** The photos picked for the Showcase, in chosen order. */
  photoIds?: string[];
}

export async function createShowcaseDraft(
  supabase: SupabaseClient,
  input: CreateShowcaseDraftInput,
): Promise<Showcase> {
  // Trust nothing about the client-supplied selection: keep only photo ids that
  // actually belong to this Job (the query runs under the caller's RLS, so this
  // also drops cross-Organization ids), deduped, preserving the chosen order.
  const photoIds = await sanitizedJobPhotoIds(
    supabase,
    input.jobId,
    input.photoIds ?? [],
  );

  const { data: showcase, error } = await supabase
    .from("showcases")
    .insert({
      organization_id: input.organizationId,
      job_id: input.jobId,
      title: input.title?.trim() ?? "",
      write_up: input.writeUp ?? "",
      photo_ids: photoIds,
      status: "draft",
      created_by: input.createdBy,
    })
    .select("*")
    .single<Showcase>();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) throw new ShowcaseAlreadyExistsError();
    throw new Error(error.message);
  }
  if (!showcase) throw new Error("Showcase insert returned no row");
  return showcase;
}

/**
 * Filter a client-supplied photo selection down to the ids that actually belong
 * to `jobId`, deduped and in the original order, by intersecting the requested
 * ids with the Job's own photos (read under the caller's RLS, so other
 * Organizations' photos are excluded too) through the pure selection gate.
 * Returns an empty array (without a round-trip) when nothing was selected.
 *
 * Exported so the autosave route can re-run the same integrity gate on every
 * photo write — a public Showcase gallery must never leak another Job's photo.
 */
export async function sanitizedJobPhotoIds(
  supabase: SupabaseClient,
  jobId: string,
  requestedIds: string[],
): Promise<string[]> {
  if (requestedIds.length === 0) return [];
  const { data, error } = await supabase
    .from("photos")
    .select("id")
    .eq("job_id", jobId)
    .in("id", requestedIds);
  if (error) throw new Error(error.message);
  const jobPhotoIds = (data ?? []).map((row) => (row as { id: string }).id);
  return sanitizeShowcasePhotoSelection(jobPhotoIds, requestedIds);
}
