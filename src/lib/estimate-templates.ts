// src/lib/estimate-templates.ts — template surface.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EstimateTemplate,
  TemplateStructure,
  TemplateStructureItem,
  TemplateWithContents,
} from "@/lib/types";

export interface ListTemplatesFilters {
  search?: string;
  damageType?: string;
  isActive?: boolean | null; // null = include inactive too
}

export async function listTemplates(
  supabase: SupabaseClient,
  organizationId: string,
  filters: ListTemplatesFilters = {},
): Promise<EstimateTemplate[]> {
  let q = supabase
    .from("estimate_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name");

  if (filters.isActive === true) q = q.eq("is_active", true);
  if (filters.isActive === false) q = q.eq("is_active", false);
  // null / undefined → no filter (includes both)

  if (filters.search) {
    // Use the lib/postgrest escape helper for user-input substring match.
    const { escapeOrFilterValue } = await import("@/lib/postgrest");
    const safe = escapeOrFilterValue(filters.search);
    q = q.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  if (filters.damageType) {
    q = q.contains("damage_type_tags", JSON.stringify([filters.damageType]));
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EstimateTemplate[];
}

export async function getTemplate(
  supabase: SupabaseClient,
  id: string,
): Promise<EstimateTemplate | null> {
  const { data } = await supabase.from("estimate_templates").select("*").eq("id", id).maybeSingle<EstimateTemplate>();
  return data ?? null;
}

/** Templates have no separate sections/line-items tables — `structure` JSONB is the source of truth.
 *  This helper projects the JSONB into the same nested shape the builder shell expects (TemplateWithContents).
 *  It synthesizes UUIDs for client-side keys; those keys do NOT correspond to DB rows. */
export async function getTemplateWithContents(
  supabase: SupabaseClient,
  id: string,
): Promise<TemplateWithContents | null> {
  const tmpl = await getTemplate(supabase, id);
  if (!tmpl) return null;

  const structure = (tmpl.structure ?? { sections: [] }) as TemplateStructure;
  const sections = (structure.sections ?? []).map((s, sIdx) => {
    const synthSectionId = `synth-sec-${id}-${sIdx}`;
    return {
      id: synthSectionId,
      title: s.title,
      sort_order: s.sort_order,
      parent_section_id: null,
      items: (s.items ?? []).map((it, iIdx) => synthItemFromTemplate(synthSectionId, iIdx, it)),
      subsections: (s.subsections ?? []).map((sub, subIdx) => {
        const synthSubId = `synth-sub-${id}-${sIdx}-${subIdx}`;
        return {
          id: synthSubId,
          title: sub.title,
          sort_order: sub.sort_order,
          items: (sub.items ?? []).map((it, iIdx) => synthItemFromTemplate(synthSubId, iIdx, it)),
        };
      }),
    };
  });

  return { ...tmpl, sections } as TemplateWithContents;
}

function synthItemFromTemplate(synthSectionId: string, idx: number, item: TemplateStructureItem) {
  return {
    id: `synth-item-${synthSectionId}-${idx}`,
    library_item_id: item.library_item_id,
    description: item.description_override ?? "",
    code: null,
    quantity: item.quantity_override ?? 1,
    unit: null,
    unit_price: item.unit_price_override ?? 0,
    sort_order: item.sort_order,
  };
}

/** Materialize the live builder state into a `structure` JSONB shape. Called by
 *  the Save Template button (and by every auto-save tick in template mode, since
 *  template auto-save collapses to rootPut-only and rootPut writes both metadata
 *  AND structure). */
export function serializeStructureFromBuilder(state: TemplateWithContents): TemplateStructure {
  return {
    sections: state.sections.map((s) => ({
      title: s.title,
      sort_order: s.sort_order,
      items: s.items.map((it) => ({
        library_item_id: it.library_item_id,
        description_override: it.description || null,
        quantity_override: it.quantity ?? null,
        unit_price_override: it.unit_price ?? null,
        sort_order: it.sort_order,
      })),
      subsections: s.subsections.map((sub) => ({
        title: sub.title,
        sort_order: sub.sort_order,
        items: sub.items.map((it) => ({
          library_item_id: it.library_item_id,
          description_override: it.description || null,
          quantity_override: it.quantity ?? null,
          unit_price_override: it.unit_price ?? null,
          sort_order: it.sort_order,
        })),
      })),
    })),
  };
}

export interface CreateTemplateInput {
  name: string;
  description?: string | null;
  damage_type_tags?: string[];
  opening_statement?: string | null;
  closing_statement?: string | null;
}

export async function createTemplate(
  supabase: SupabaseClient,
  organizationId: string,
  createdBy: string,
  input: CreateTemplateInput,
): Promise<EstimateTemplate> {
  const { data, error } = await supabase
    .from("estimate_templates")
    .insert({
      organization_id: organizationId,
      name: input.name,
      description: input.description ?? null,
      damage_type_tags: input.damage_type_tags ?? [],
      opening_statement: input.opening_statement ?? null,
      closing_statement: input.closing_statement ?? null,
      structure: { sections: [] },
      is_active: true,
      created_by: createdBy,
    })
    .select()
    .single<EstimateTemplate>();
  if (error) throw error;
  return data;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  damage_type_tags?: string[];
  opening_statement?: string | null;
  closing_statement?: string | null;
  structure?: TemplateStructure;
  is_active?: boolean;
}

export async function updateTemplate(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateTemplateInput,
): Promise<EstimateTemplate> {
  const { data, error } = await supabase
    .from("estimate_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single<EstimateTemplate>();
  if (error) throw error;
  return data;
}

export async function deactivateTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from("estimate_templates")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function reactivateTemplate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from("estimate_templates")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Wraps apply_template_to_estimate RPC. Returns the broken-refs report. */
export async function applyTemplate(
  supabase: SupabaseClient,
  estimateId: string,
  templateId: string,
): Promise<{
  ok: true;
  section_count: number;
  line_item_count: number;
  broken_refs: Array<{
    section_idx: number;
    item_idx: number;
    library_item_id: string | null;
    placeholder: boolean;
    in_subsection?: boolean;
    subsection_idx?: number;
  }>;
} | {
  ok: false;
  code: "estimate_not_found" | "estimate_not_draft" | "estimate_not_empty" | "template_not_found_or_inactive" | "internal";
  message?: string;
}> {
  const { data, error } = await supabase.rpc("apply_template_to_estimate", {
    p_estimate_id: estimateId,
    p_template_id: templateId,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("estimate_not_found")) return { ok: false, code: "estimate_not_found" };
    if (m.includes("estimate_not_draft")) return { ok: false, code: "estimate_not_draft" };
    if (m.includes("estimate_not_empty")) return { ok: false, code: "estimate_not_empty" };
    if (m.includes("template_not_found_or_inactive")) return { ok: false, code: "template_not_found_or_inactive" };
    return { ok: false, code: "internal", message: m };
  }
  // RPC returns a jsonb object directly
  return { ok: true, ...(data as { section_count: number; line_item_count: number; broken_refs: Array<unknown> }) } as never;
}
