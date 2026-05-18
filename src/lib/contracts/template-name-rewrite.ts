/**
 * Contract-template name rewrite (issue #111, slice 2 of the `full_name` PRD).
 *
 * Contract templates are PDF-overlay only: a customer's name is placed as one
 * or two `merge`-type overlay stamps at fixed coordinates. When a first-name
 * stamp and a last-name stamp sit on the same line, the horizontal space
 * between them renders as an unwanted gap.
 *
 * This pure transform collapses the split name into the single `customer_name`
 * merge field (which resolves from `contacts.full_name`): the first-name stamp
 * is renamed to `customer_name` and the now-redundant last-name stamp is
 * dropped. A template carrying only a last-name stamp has it renamed instead.
 *
 * Name overlay fields are identified by their merge-field registry mapping
 * (`contact.first_name` / `contact.last_name`), not by slug string, because
 * the slugs are org-specific form_config values. The auto-rewrite migration
 * mirrors this logic in SQL.
 */

import type { OverlayField } from "./types";
import type { MergeFieldDefinition } from "./merge-field-registry";

const CUSTOMER_NAME_SLUG = "customer_name";

function slugsForColumn(
  registry: MergeFieldDefinition[],
  column: string,
): Set<string> {
  const out = new Set<string>();
  for (const def of registry) {
    if (def.source.kind === "maps_to" && def.source.column === column) {
      out.add(def.slug);
    }
  }
  return out;
}

/**
 * Rewrite a contract template's overlay fields so a split first/last customer
 * name collapses into the single `customer_name` merge field. Returns a new
 * array; the input is not mutated. Idempotent — a template already using
 * `customer_name` (or carrying no name field) is returned unchanged.
 */
export function rewriteOverlayNameFields(
  overlayFields: OverlayField[],
  registry: MergeFieldDefinition[],
): OverlayField[] {
  const firstNameSlugs = slugsForColumn(registry, "contact.first_name");
  const lastNameSlugs = slugsForColumn(registry, "contact.last_name");

  const isMergeSlug = (f: OverlayField, slugs: Set<string>) =>
    f.type === "merge" && f.mergeFieldName != null && slugs.has(f.mergeFieldName);

  const hasFirstName = overlayFields.some((f) => isMergeSlug(f, firstNameSlugs));

  const out: OverlayField[] = [];
  for (const field of overlayFields) {
    if (isMergeSlug(field, firstNameSlugs)) {
      out.push({ ...field, mergeFieldName: CUSTOMER_NAME_SLUG });
      continue;
    }
    if (isMergeSlug(field, lastNameSlugs)) {
      // A first-name stamp already becomes `customer_name` (the full name),
      // so an accompanying last-name stamp is redundant — drop it. With no
      // first-name stamp, the last-name stamp is the only name field, so
      // rename it instead.
      if (hasFirstName) continue;
      out.push({ ...field, mergeFieldName: CUSTOMER_NAME_SLUG });
      continue;
    }
    out.push(field);
  }
  return out;
}
