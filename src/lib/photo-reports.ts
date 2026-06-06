// Issue #400 — Photo Report Rework, Slice 2a.
//
// The server-side create step for the in-Job Photo Report builder. The Job
// Photos tab's "Create report" action POSTs here (via the route that wraps this
// in a Request Context); this function owns the data work so it can be tested
// against a fake Supabase client without an HTTP layer:
//
//   - number the report per Job (max existing + 1) via `nextReportNumber`,
//   - stamp `created_by` with the real preparer's name (the column is text and
//     historically defaulted to the literal 'Eric'; #400 writes the real name),
//   - seed the one default Section from the selected photos, and
//   - insert the row as a `draft`, scoped to the Organization and Job.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PhotoReport, PhotoReportTemplate } from "@/lib/types";
import { nextReportNumber } from "./next-report-number";
import { buildDefaultReportSections } from "./photo-report-builder";
import { buildInitialSections } from "./build-initial-sections";

export interface CreatePhotoReportDraftInput {
  organizationId: string;
  jobId: string;
  /** Display name stored into `created_by` (the report's "Prepared by"). */
  preparerName: string;
  /** The photos selected on the Job Photos tab, in selection order. */
  photoIds: string[];
  /** Optional title; defaults to "Photo Report #N". */
  title?: string;
  /**
   * Optional Photo Report template to start from (#405). When set and the row
   * resolves (it is fetched under the caller's RLS, so a foreign or deleted id
   * simply resolves to nothing and is ignored), the report's Sections are seeded
   * from the template's boilerplate and `template_id` is recorded as provenance
   * only — it never binds rendering (ADR 0003 amendment, retained by ADR 0009).
   */
  templateId?: string | null;
}

/** Postgres SQLSTATE for unique_violation, surfaced via PostgREST's error code. */
const UNIQUE_VIOLATION = "23505";

/**
 * How many times to re-number-and-insert before giving up. Each lost race frees
 * exactly one number, so under any realistic concurrency a couple of retries
 * settle it; the bound just keeps a genuinely stuck insert from spinning.
 */
const MAX_REPORT_NUMBER_ATTEMPTS = 3;

export async function createPhotoReportDraft(
  supabase: SupabaseClient,
  input: CreatePhotoReportDraftInput,
): Promise<PhotoReport> {
  // Trust nothing about the client-supplied selection: keep only photo ids that
  // actually belong to this Job (the query runs under the caller's RLS, so this
  // also drops any cross-Organization ids) and preserve the selection order.
  // Otherwise a caller could seed another Job's photos — or junk ids — into the
  // report's sections JSONB. Mirrors the photos/bulk routes' job-scoped check.
  const photoIds = await ownedJobPhotoIds(supabase, input.jobId, input.photoIds);

  // Resolve the optional template (#405). Fetched under the caller's RLS, so a
  // foreign or deleted id resolves to nothing and the report falls back to the
  // blank, single-Photos-section start. `template_id` is provenance only.
  const template = await fetchTemplate(supabase, input.templateId);

  const sections = template
    ? // Start from the template's boilerplate Sections (heading + write-up, no
      // photos), then append the user's selection as a separate Photos section
      // they can redistribute in the builder. With nothing selected there is no
      // Photos section to append.
      [
        ...buildInitialSections(template),
        ...(photoIds.length > 0 ? buildDefaultReportSections(photoIds) : []),
      ]
    : buildDefaultReportSections(photoIds);

  // Per-Job numbering is read-then-insert with no DB-side serialization, so two
  // near-simultaneous "Create report" clicks on the same Job can read the same
  // max and mint the same display number. The partial unique index on
  // (job_id, report_number) WHERE deleted_at IS NULL (migration 412) turns that
  // into a unique_violation on insert; we catch it, re-read the numbers (now
  // including whatever the competing click committed), and retry with the next
  // free number. Bounded so a persistently failing insert surfaces its error
  // rather than spinning forever (#447 #1).
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < MAX_REPORT_NUMBER_ATTEMPTS; attempt++) {
    const reportNumber = await nextReportNumberForJob(supabase, input.jobId);
    const title = input.title?.trim() || `Photo Report #${reportNumber}`;

    const { data: report, error } = await supabase
      .from("photo_reports")
      .insert({
        organization_id: input.organizationId,
        job_id: input.jobId,
        template_id: template?.id ?? null,
        title,
        report_number: reportNumber,
        created_by: input.preparerName,
        sections,
        status: "draft",
      })
      .select("*")
      .single<PhotoReport>();

    if (!error) {
      if (!report) throw new Error("Photo report insert returned no row");
      return report;
    }
    // Only a number collision is retryable; any other DB error is fatal.
    if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
    lastError = error;
  }

  throw new Error(
    `Could not assign a unique report number after ${MAX_REPORT_NUMBER_ATTEMPTS} attempts` +
      (lastError ? `: ${lastError.message}` : ""),
  );
}

/**
 * Read the Job's existing `report_number`s and return the next one (max + 1).
 * Re-read on each insert attempt so a retry picks up any number a competing
 * "Create report" click committed in the meantime.
 */
async function nextReportNumberForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<number> {
  const { data: existing, error } = await supabase
    .from("photo_reports")
    .select("report_number")
    .eq("job_id", jobId);
  if (error) throw new Error(error.message);

  const existingNumbers = (existing ?? [])
    .map((row) => (row as { report_number: number | null }).report_number)
    .filter((n): n is number => typeof n === "number");
  return nextReportNumber(existingNumbers);
}

/**
 * Resolve an optional Photo Report template id to its row, or null. Runs under
 * the caller's Supabase client, so RLS scopes the lookup to the caller's Active
 * Organization — a foreign id (another Organization's, or a deleted one) simply
 * resolves to null and the caller treats it as "start blank". Returns null
 * without a round-trip when no id was given.
 */
async function fetchTemplate(
  supabase: SupabaseClient,
  templateId: string | null | undefined,
): Promise<PhotoReportTemplate | null> {
  if (!templateId) return null;
  const { data, error } = await supabase
    .from("photo_report_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle<PhotoReportTemplate>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Filter a client-supplied photo selection down to the ids that actually belong
 * to `jobId`, preserving the original selection order. Runs under the caller's
 * Supabase client, so RLS also excludes other Organizations' photos. Returns an
 * empty array (without a round-trip) when nothing was selected.
 */
async function ownedJobPhotoIds(
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
  const owned = new Set((data ?? []).map((row) => (row as { id: string }).id));
  return requestedIds.filter((id) => owned.has(id));
}
