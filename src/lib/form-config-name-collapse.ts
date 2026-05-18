/**
 * form_config name collapse (issue #112, PRD #109, full_name slice 3).
 *
 * The intake form is moving from two name fields — one mapped to
 * `contact.first_name`, one to `contact.last_name` — to a single "Full Name"
 * field mapped to `contact.full_name`. This pure transform collapses an
 * organization's saved `form_config` JSON accordingly:
 *
 *   - the two name fields become one field at the former first-name field's
 *     position (or the last-name field's position if only that one exists);
 *   - the collapsed field is required if either original field was required;
 *   - it carries merge slug `customer_name` so contract templates resolve it
 *     to the contact's full name.
 *
 * Mirrored by the form_config auto-migration. Idempotent: a config with no
 * legacy name field is returned unchanged.
 */

import type { FormConfig, FormField } from "./types";

const FIRST_NAME_MAP = "contact.first_name";
const LAST_NAME_MAP = "contact.last_name";
const FULL_NAME_MAP = "contact.full_name";

interface FieldLocation {
  sectionIndex: number;
  fieldIndex: number;
  field: FormField;
}

function locate(config: FormConfig, mapsTo: string): FieldLocation | null {
  for (let s = 0; s < config.sections.length; s++) {
    const fields = config.sections[s].fields;
    for (let f = 0; f < fields.length; f++) {
      if (fields[f].maps_to === mapsTo) {
        return { sectionIndex: s, fieldIndex: f, field: fields[f] };
      }
    }
  }
  return null;
}

/**
 * Collapse the two legacy name fields in an intake `form_config` into a single
 * "Full Name" field. Returns a new config; the input is never mutated.
 */
export function collapseNameFields(config: FormConfig): FormConfig {
  const first = locate(config, FIRST_NAME_MAP);
  const last = locate(config, LAST_NAME_MAP);

  // Nothing to collapse — already migrated, or never had the name fields.
  if (!first && !last) return config;

  // The collapsed field keeps the anchor field's id and built-in flags; only
  // its name-specific properties change. The anchor is the first-name field
  // when present, otherwise the lone last-name field.
  const anchor = first ?? last!;
  const collapsed: FormField = {
    ...anchor.field,
    type: "text",
    label: "Full Name",
    maps_to: FULL_NAME_MAP,
    required: Boolean(first?.field.required) || Boolean(last?.field.required),
    merge_field_slug: "customer_name",
  };

  // When both fields exist, the last-name field is dropped.
  const removed = first && last ? last : null;

  const sections = config.sections.map((section, s) => ({
    ...section,
    fields: section.fields
      .map((field, f) =>
        s === anchor.sectionIndex && f === anchor.fieldIndex ? collapsed : field,
      )
      .filter(
        (_field, f) =>
          !(removed && s === removed.sectionIndex && f === removed.fieldIndex),
      ),
  }));

  return { ...config, sections };
}
