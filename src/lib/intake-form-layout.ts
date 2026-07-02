import type { FormField } from "./types";

// Display-only row planning for the intake form (#915, design-system §7.2):
// at iPad width related fields sit two-up, unrelated fields stay single
// column. "Related" is derived purely from the org's config — adjacent
// compact fields pair — so any custom-field arrangement lays out correctly
// without form-config changes.

/**
 * Field types whose values are intrinsically short, so two of them share a
 * row at `md`+ without ever truncating content. Free text stays full-width
 * (it can hold anything — addresses, names), as do rich widgets.
 */
const COMPACT_TYPES = new Set<FormField["type"]>(["phone", "email", "number", "date", "select"]);

/**
 * maps_to targets the renderer quiet-swaps for rich pickers regardless of the
 * configured type (InsuranceCompanyPicker #195, ReferrerPicker #302) — they
 * lay out as widgets, never as compact inputs.
 */
const PICKER_TARGETS = new Set(["job.insurance_company", "job.referral_partner_id"]);

function isCompact(f: FormField): boolean {
  return COMPACT_TYPES.has(f.type) && !(f.maps_to && PICKER_TARGETS.has(f.maps_to));
}

/** Groups fields into display rows: adjacent compact fields pair, everything else gets its own row. */
export function planFieldRows(fields: FormField[]): FormField[][] {
  const rows: FormField[][] = [];
  for (const f of fields) {
    const prev = rows[rows.length - 1];
    if (prev?.length === 1 && isCompact(prev[0]) && isCompact(f)) {
      prev.push(f);
    } else {
      rows.push([f]);
    }
  }
  return rows;
}
