// Build 67c2 — resolve {merge_field} tokens in estimate/invoice send
// templates against the document's job. Returns subject + html + the list
// of fields that didn't have a value so the modal can warn the user.
//
// Wraps buildMergeFieldValues from contracts/merge-fields with no extras.
// We avoid importing from contracts/* in non-contract code paths in route
// handlers; this thin wrapper is the layering boundary.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMergeFieldValues,
  applyMergeFieldValues,
} from "@/lib/contracts/merge-fields";

export interface ResolvedTemplate {
  subject: string;
  html: string;
  unresolvedFields: string[];
}

export async function resolveDocumentTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  jobId: string,
): Promise<ResolvedTemplate> {
  const values = await buildMergeFieldValues(supabase, jobId);

  const subjResult = applyMergeFieldValues(subjectTemplate, values);
  // Subject is plain text; decode entities the resolver introduced.
  const subject = subjResult.html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const bodyResult = applyMergeFieldValues(bodyTemplate, values);

  const unresolvedFields = Array.from(
    new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]),
  );

  return { subject, html: bodyResult.html, unresolvedFields };
}
