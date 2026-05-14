import type { FormConfig } from "@/lib/types";

export type MergeFieldSource =
  | { kind: "maps_to"; column: string }
  | { kind: "job_custom_fields"; field_key: string }
  | { kind: "system"; key: string };

export interface MergeFieldDefinition {
  slug: string;
  label: string;
  section: string;
  source: MergeFieldSource;
  options?: { value: string; label: string }[];
  // Set when the source form_config field (or its section) is hidden.
  // Hidden entries stay in the registry so existing contracts referencing
  // their slug continue to resolve from job_custom_fields. Picker UIs
  // should filter these out when authoring new templates.
  hidden?: boolean;
}

export function buildMergeFieldRegistry(
  formConfig: FormConfig,
  systemFields: MergeFieldDefinition[],
): MergeFieldDefinition[] {
  const out: MergeFieldDefinition[] = [];
  for (const section of formConfig.sections) {
    const sectionHidden = section.visible === false;
    for (const field of section.fields) {
      const fieldHidden = sectionHidden || field.visible === false;
      const slug = field.merge_field_slug ?? field.id;
      const source: MergeFieldSource = field.maps_to
        ? { kind: "maps_to", column: field.maps_to }
        : { kind: "job_custom_fields", field_key: field.id };
      const entry: MergeFieldDefinition = {
        slug,
        label: field.label,
        section: section.title,
        source,
      };
      if (field.options) {
        entry.options = field.options.map((o) => ({ value: o.value, label: o.label }));
      }
      if (fieldHidden) entry.hidden = true;
      out.push(entry);
    }
  }
  out.push(...systemFields);
  return out;
}
