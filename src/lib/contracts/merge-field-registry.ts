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
}

export function buildMergeFieldRegistry(
  formConfig: FormConfig,
  systemFields: MergeFieldDefinition[],
): MergeFieldDefinition[] {
  const out: MergeFieldDefinition[] = [];
  for (const section of formConfig.sections) {
    if (section.visible === false) continue;
    for (const field of section.fields) {
      if (field.visible === false) continue;
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
      out.push(entry);
    }
  }
  out.push(...systemFields);
  return out;
}
