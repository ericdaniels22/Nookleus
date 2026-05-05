import type { SupabaseClient } from "@supabase/supabase-js";
import type { MergeFieldCategory, MergeFieldDefinition } from "./types";

export const MERGE_FIELDS: MergeFieldDefinition[] = [
  // Customer
  { name: "customer_name", label: "Customer Name", category: "Customer" },
  { name: "customer_first_name", label: "Customer First Name", category: "Customer" },
  { name: "customer_email", label: "Customer Email", category: "Customer" },
  { name: "customer_phone", label: "Customer Phone", category: "Customer" },
  { name: "customer_address", label: "Customer Address", category: "Customer" },
  // Property
  { name: "property_address", label: "Property Address", category: "Property" },
  { name: "property_type", label: "Property Type", category: "Property" },
  // Job
  { name: "job_number", label: "Job Number", category: "Job" },
  { name: "damage_type", label: "Damage Type", category: "Job" },
  { name: "damage_source", label: "Damage Source", category: "Job" },
  { name: "date_today", label: "Today's Date", category: "Job" },
  { name: "intake_date", label: "Intake Date", category: "Job" },
  { name: "affected_areas", label: "Affected Areas", category: "Job" },
  // Insurance
  { name: "insurance_company", label: "Insurance Company", category: "Insurance" },
  { name: "claim_number", label: "Claim Number", category: "Insurance" },
  { name: "adjuster_name", label: "Adjuster Name", category: "Insurance" },
  { name: "adjuster_phone", label: "Adjuster Phone", category: "Insurance" },
  // Company
  { name: "company_name", label: "Company Name", category: "Company" },
  { name: "company_phone", label: "Company Phone", category: "Company" },
  { name: "company_email", label: "Company Email", category: "Company" },
  { name: "company_address", label: "Company Address", category: "Company" },
  { name: "company_license", label: "Company License", category: "Company" },
];

export const MERGE_FIELD_CATEGORIES: MergeFieldCategory[] = [
  "Customer",
  "Property",
  "Job",
  "Insurance",
  "Company",
];

export function mergeFieldsByCategory(): Record<MergeFieldCategory, MergeFieldDefinition[]> {
  const grouped = {} as Record<MergeFieldCategory, MergeFieldDefinition[]>;
  for (const cat of MERGE_FIELD_CATEGORIES) grouped[cat] = [];
  for (const field of MERGE_FIELDS) grouped[field.category].push(field);
  return grouped;
}

export function isKnownField(name: string): boolean {
  return MERGE_FIELDS.some((f) => f.name === name);
}

interface ContactRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

interface JobRow {
  id: string;
  job_number: string | null;
  damage_type: string | null;
  damage_source: string | null;
  property_address: string | null;
  property_type: string | null;
  affected_areas: string | null;
  insurance_company: string | null;
  claim_number: string | null;
  created_at: string | null;
  contact_id: string;
}

function formatDamageType(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function fullName(c: ContactRow | null): string | null {
  if (!c) return null;
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return n || null;
}

/**
 * Queries job + linked contact + primary adjuster + company settings, then
 * returns a flat Record of every known merge field → its resolved string
 * value (or null if data is missing for that field on this particular job).
 *
 * Used by both the preview modal (15a) and the send flow (15b).
 */
export async function buildMergeFieldValues(
  supabase: SupabaseClient,
  jobId: string,
): Promise<Record<string, string | null>> {
  const values: Record<string, string | null> = {};
  for (const f of MERGE_FIELDS) values[f.name] = null;

  // Job
  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_number, damage_type, damage_source, property_address, property_type, affected_areas, insurance_company, claim_number, created_at, contact_id")
    .eq("id", jobId)
    .maybeSingle<JobRow>();

  if (job) {
    values.job_number = job.job_number;
    values.damage_type = formatDamageType(job.damage_type);
    values.damage_source = job.damage_source;
    values.property_address = job.property_address;
    values.property_type = job.property_type
      ? formatDamageType(job.property_type) // same title-case helper
      : null;
    values.affected_areas = job.affected_areas;
    values.insurance_company = job.insurance_company;
    values.claim_number = job.claim_number;
    values.intake_date = formatDate(job.created_at);
  }
  values.date_today = formatDate(new Date().toISOString());

  // Contact (customer)
  if (job?.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("first_name, last_name, email, phone")
      .eq("id", job.contact_id)
      .maybeSingle<ContactRow>();
    if (contact) {
      values.customer_name = fullName(contact);
      values.customer_first_name = contact.first_name;
      values.customer_email = contact.email;
      values.customer_phone = contact.phone;
    }
  }
  // Contacts has no address column; property_address doubles as the
  // customer's address for homeowner jobs. Confirmed fallback.
  values.customer_address = values.property_address;

  // Primary adjuster via job_adjusters junction (build31+).
  if (job?.id) {
    const { data: adjusterLinks } = await supabase
      .from("job_adjusters")
      .select("contact_id, is_primary")
      .eq("job_id", job.id);
    const primary = adjusterLinks?.find((a) => a.is_primary) ?? adjusterLinks?.[0];
    if (primary?.contact_id) {
      const { data: adj } = await supabase
        .from("contacts")
        .select("first_name, last_name, phone")
        .eq("id", primary.contact_id)
        .maybeSingle<ContactRow>();
      if (adj) {
        values.adjuster_name = fullName(adj);
        values.adjuster_phone = adj.phone;
      }
    }
  }

  // Company settings (key/value store)
  const { data: settings } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["company_name", "phone", "email", "address", "license"]);
  if (settings) {
    const map = new Map(settings.map((s: { key: string; value: string | null }) => [s.key, s.value]));
    values.company_name = map.get("company_name") ?? null;
    values.company_phone = map.get("phone") ?? null;
    values.company_email = map.get("email") ?? null;
    values.company_address = map.get("address") ?? null;
    values.company_license = map.get("license") ?? null;
  }

  return values;
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
 * resolved from the given job. Two shapes are supported:
 *
 *   - Tiptap pill span: <span data-field-name="x" ...>{{x}}</span>
 *   - Raw token:        {{x}}
 *
 * Unknown or missing fields render as a visible blank line styled by the
 * .merge-field-unresolved CSS class so reviewers can see what still needs data.
 */
export function applyMergeFieldValues(
  html: string,
  values: Record<string, string | null>,
): { html: string; unresolvedFields: string[] } {
  const unresolved = new Set<string>();
  let output = html;

  // A field is "supplied" either by being a standard contract merge field
  // (in MERGE_FIELDS) or by showing up in the values map. The values-map
  // escape hatch lets callers (e.g. the email-template resolver) inject
  // extras like signing_link / document_title without polluting the
  // contract template field list.
  const hasValue = (name: string) => {
    const v = values[name];
    return v !== undefined && v !== null && v !== "";
  };

  // 1. Replace Tiptap pill spans (wraps both unknown and known).
  output = output.replace(
    /<span\b[^>]*\bdata-field-name="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_match, fieldName: string) => {
      if (!isKnownField(fieldName) && !(fieldName in values)) {
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

  // 2. Replace any remaining bare {{field_name}} tokens.
  output = output.replace(/\{\{([a-z_][a-z0-9_]*)\}\}/gi, (_match, fieldName: string) => {
    if (!isKnownField(fieldName) && !(fieldName in values)) {
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

/**
 * Convenience wrapper: resolve merge fields for a given job and template HTML
 * in one call. Build 15b's send flow will use this same path to snapshot the
 * filled HTML at send time.
 */
export async function resolveMergeFields(
  supabase: SupabaseClient,
  contentHtml: string,
  jobId: string,
): Promise<{ html: string; unresolvedFields: string[] }> {
  const values = await buildMergeFieldValues(supabase, jobId);
  return applyMergeFieldValues(contentHtml, values);
}
