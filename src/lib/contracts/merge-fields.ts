import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormConfig } from "@/lib/types";
import { buildMergeFieldRegistry, type MergeFieldDefinition } from "./merge-field-registry";
import { resolveMergeFieldValues } from "./merge-field-resolver";

// The 9 system-source merge fields that are always available regardless of
// form_config. Mirrors the names and labels in MERGE_FIELDS but with the
// registry's source-discriminator shape so the resolver can dispatch them.
export const SYSTEM_MERGE_FIELDS: MergeFieldDefinition[] = [
  { slug: "date_today", label: "Today's Date", section: "System", source: { kind: "system", key: "date_today" } },
  { slug: "intake_date", label: "Intake Date", section: "System", source: { kind: "system", key: "intake_date" } },
  // Composite legacy synonyms: pre-#67 buildMergeFieldValues computed these
  // inline. customer_name = contact.first_name + " " + last_name;
  // customer_address = job.property_address. Kept as system-source so
  // existing contract templates that reference them keep resolving.
  { slug: "customer_name", label: "Customer Name", section: "System", source: { kind: "system", key: "customer_name" } },
  { slug: "customer_address", label: "Customer Address", section: "System", source: { kind: "system", key: "customer_address" } },
  { slug: "adjuster_name", label: "Adjuster Name", section: "System", source: { kind: "system", key: "adjuster_name" } },
  { slug: "adjuster_phone", label: "Adjuster Phone", section: "System", source: { kind: "system", key: "adjuster_phone" } },
  { slug: "company_name", label: "Company Name", section: "System", source: { kind: "system", key: "company_name" } },
  { slug: "company_phone", label: "Company Phone", section: "System", source: { kind: "system", key: "company_phone" } },
  { slug: "company_email", label: "Company Email", section: "System", source: { kind: "system", key: "company_email" } },
  { slug: "company_address", label: "Company Address", section: "System", source: { kind: "system", key: "company_address" } },
  { slug: "company_license", label: "Company License", section: "System", source: { kind: "system", key: "company_license" } },
];

async function fetchLatestFormConfig(
  supabase: SupabaseClient,
  organizationId: string | null,
): Promise<FormConfig> {
  // Service-role callers (e.g. /sign/[token]) bypass RLS, so without an
  // explicit org filter this query returns the global-max-version row —
  // which on multi-org installs leaks a foreign org's intake schema into
  // the merge registry.
  let query = supabase
    .from("form_config")
    .select("config")
    .order("version", { ascending: false })
    .limit(1);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data } = await query.maybeSingle<{ config: FormConfig }>();
  return data?.config ?? { sections: [] };
}

export async function buildMergeFieldValues(
  supabase: SupabaseClient,
  jobId: string,
): Promise<Record<string, string | null>> {
  const { data: jobOrg } = await supabase
    .from("jobs")
    .select("organization_id")
    .eq("id", jobId)
    .maybeSingle<{ organization_id: string | null }>();
  const orgId = jobOrg?.organization_id ?? null;

  const formConfig = await fetchLatestFormConfig(supabase, orgId);
  const registry = buildMergeFieldRegistry(formConfig, SYSTEM_MERGE_FIELDS);
  return resolveMergeFieldValues(supabase, jobId, registry, orgId);
}

const UNRESOLVED_SPAN = '<span class="merge-field-unresolved">________</span>';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Replaces merge-field markup in a rendered HTML template with values
 * resolved from the given job. Two shapes:
 *   - Tiptap pill span: <span data-field-name="x" ...>{{x}}</span>
 *   - Raw token:        {{x}}
 *
 * A field is "supplied" iff its slug appears in the values map. The
 * resolver pre-populates the map with every registry slug (null when
 * missing) so unknown-to-registry slugs show as `unresolved`. Callers
 * can inject extras (e.g. signing_link) by adding to the map after
 * buildMergeFieldValues.
 */
export function applyMergeFieldValues(
  html: string,
  values: Record<string, string | null>,
): { html: string; unresolvedFields: string[] } {
  const unresolved = new Set<string>();
  let output = html;

  const hasValue = (name: string) => {
    const v = values[name];
    return v !== undefined && v !== null && v !== "";
  };

  output = output.replace(
    /<span\b[^>]*\bdata-field-name="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_match, fieldName: string) => {
      if (!(fieldName in values)) {
        unresolved.add(fieldName);
        return UNRESOLVED_SPAN;
      }
      if (!hasValue(fieldName)) {
        unresolved.add(fieldName);
        return UNRESOLVED_SPAN;
      }
      return escapeHtml(values[fieldName] as string);
    },
  );

  output = output.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/gi, (_match, fieldName: string) => {
    if (!(fieldName in values)) {
      unresolved.add(fieldName);
      return UNRESOLVED_SPAN;
    }
    if (!hasValue(fieldName)) {
      unresolved.add(fieldName);
      return UNRESOLVED_SPAN;
    }
    return escapeHtml(values[fieldName] as string);
  });

  return { html: output, unresolvedFields: Array.from(unresolved) };
}

export async function resolveMergeFields(
  supabase: SupabaseClient,
  contentHtml: string,
  jobId: string,
): Promise<{ html: string; unresolvedFields: string[] }> {
  const values = await buildMergeFieldValues(supabase, jobId);
  return applyMergeFieldValues(contentHtml, values);
}
