import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMergeFieldValues } from "./merge-fields";

export interface ResolveMergeValuesOptions {
  /**
   * Override the resolved `date_today` value. Used by previews + the
   * sign-time stamping flow to substitute the real signed_at date. If
   * omitted, falls back to the value computed by buildMergeFieldValues
   * (which uses today's wall clock).
   */
  signedAt?: Date;
}

function formatSignedDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Resolves all known MERGE_FIELDS for a job into a flat
 * `Record<mergeFieldName, string>`, with nulls coerced to empty strings
 * and any newlines flattened to spaces (overlay fields render single-line
 * in v1).
 *
 * Wraps buildMergeFieldValues so legacy email and contract-render paths
 * stay aligned with the stamping flow.
 */
export async function resolveMergeValues(
  supabase: SupabaseClient,
  jobId: string,
  options: ResolveMergeValuesOptions = {},
): Promise<Record<string, string>> {
  const raw = await buildMergeFieldValues(supabase, jobId);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    out[name] = (value ?? "").replace(/[\r\n]+/g, " ");
  }
  if (options.signedAt) {
    out.date_today = formatSignedDate(options.signedAt);
  }
  return out;
}
