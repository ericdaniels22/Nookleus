import type { SupabaseClient } from "@supabase/supabase-js";
import type { MergeFieldDefinition } from "./merge-field-registry";

interface JobRow {
  id: string;
  contact_id: string | null;
  [col: string]: unknown;
}

interface ContactRow {
  [col: string]: unknown;
}

function formatDate(iso: string | null | undefined): string | null {
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

function fullName(row: ContactRow | null): string | null {
  if (!row) return null;
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return n || null;
}

function resolveSystem(
  key: string,
  job: JobRow | null,
  adjuster: ContactRow | null,
  settings: Map<string, string | null>,
): string | null {
  switch (key) {
    case "date_today":
      return formatDate(new Date().toISOString());
    case "intake_date":
      return formatDate((job?.created_at as string | null | undefined) ?? null);
    case "adjuster_name":
      return fullName(adjuster);
    case "adjuster_phone":
      return (adjuster?.phone as string | null | undefined) ?? null;
    case "company_name":
      return settings.get("company_name") ?? null;
    case "company_phone":
      return settings.get("phone") ?? null;
    case "company_email":
      return settings.get("email") ?? null;
    case "company_address":
      return settings.get("address") ?? null;
    case "company_license":
      return settings.get("license") ?? null;
    default:
      return null;
  }
}

const LEGACY_TITLECASE_COLUMNS = new Set(["damage_type", "property_type"]);

function titleCaseSnake(raw: string): string {
  return raw
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function applyOptionLabel(
  raw: string | null,
  options: MergeFieldDefinition["options"],
): string | null {
  if (raw == null) return null;
  if (!options) return raw;
  const match = options.find((o) => o.value === raw);
  return match ? match.label : raw;
}

export async function resolveMergeFieldValues(
  supabase: SupabaseClient,
  jobId: string,
  registry: MergeFieldDefinition[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const def of registry) out[def.slug] = null;

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle<JobRow>();

  let contact: ContactRow | null = null;
  if (job?.contact_id) {
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", job.contact_id)
      .maybeSingle<ContactRow>();
    contact = data;
  }

  const customFieldMap = new Map<string, string | null>();
  if (job?.id) {
    const { data: rows } = await supabase
      .from("job_custom_fields")
      .select("field_key, field_value")
      .eq("job_id", job.id);
    for (const r of (rows ?? []) as { field_key: string; field_value: string | null }[]) {
      customFieldMap.set(r.field_key, r.field_value);
    }
  }

  const { data: settingsRows } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["company_name", "phone", "email", "address", "license"]);
  const settings = new Map<string, string | null>();
  for (const r of (settingsRows ?? []) as { key: string; value: string | null }[]) {
    settings.set(r.key, r.value);
  }

  let adjuster: ContactRow | null = null;
  if (job?.id) {
    const { data: links } = await supabase
      .from("job_adjusters")
      .select("contact_id, is_primary")
      .eq("job_id", job.id);
    const linkRows = (links ?? []) as {
      contact_id: string;
      is_primary: boolean;
    }[];
    const primary = linkRows.find((l) => l.is_primary) ?? linkRows[0];
    if (primary?.contact_id) {
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .eq("id", primary.contact_id)
        .maybeSingle<ContactRow>();
      adjuster = data;
    }
  }

  for (const def of registry) {
    if (def.source.kind === "maps_to") {
      const [table, column] = def.source.column.split(".");
      const row = table === "contact" ? contact : table === "job" ? job : null;
      const raw = row ? (row[column] as string | null | undefined) : null;
      const labeled = applyOptionLabel(raw ?? null, def.options);
      out[def.slug] =
        labeled != null && !def.options && LEGACY_TITLECASE_COLUMNS.has(column)
          ? titleCaseSnake(labeled)
          : labeled;
    } else if (def.source.kind === "job_custom_fields") {
      const raw = customFieldMap.get(def.source.field_key) ?? null;
      out[def.slug] = applyOptionLabel(raw, def.options);
    } else if (def.source.kind === "system") {
      out[def.slug] = resolveSystem(def.source.key, job, adjuster, settings);
    }
  }

  return out;
}
