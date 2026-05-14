import type { SupabaseClient } from "@supabase/supabase-js";
import type { OverlayField } from "./types";

export interface TemplateRef {
  id: string;
  name: string;
  is_active: boolean;
}

export function extractReferencedSlugs(overlayFields: OverlayField[]): Set<string> {
  const slugs = new Set<string>();
  for (const f of overlayFields) {
    if (f.type === "merge" && f.mergeFieldName) {
      slugs.add(f.mergeFieldName);
    }
  }
  return slugs;
}

export type TemplateRow = {
  id: string;
  name: string;
  is_active: boolean;
  overlay_fields: OverlayField[] | null;
};

export function buildReferenceIndex(
  templates: TemplateRow[],
  slugs: string[],
): Record<string, TemplateRef[]> {
  const wanted = new Set(slugs);
  const out: Record<string, TemplateRef[]> = {};
  for (const slug of slugs) out[slug] = [];

  for (const t of templates) {
    const fields = t.overlay_fields ?? [];
    const referenced = extractReferencedSlugs(fields);
    for (const slug of referenced) {
      if (!wanted.has(slug)) continue;
      const list = out[slug];
      if (list.some((r) => r.id === t.id)) continue;
      list.push({ id: t.id, name: t.name, is_active: t.is_active });
    }
  }
  return out;
}

export async function findReferencingTemplates(
  supabase: SupabaseClient,
  slugs: string[],
): Promise<Record<string, TemplateRef[]>> {
  if (slugs.length === 0) return {};

  const { data, error } = await supabase
    .from("contract_templates")
    .select("id, name, is_active, overlay_fields");

  if (error) throw new Error(error.message);

  return buildReferenceIndex((data ?? []) as TemplateRow[], slugs);
}
