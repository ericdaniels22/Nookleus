import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormConfig, FormField } from "@/lib/types";
import {
  findReferencingTemplates,
  type TemplateRef,
} from "./template-reference-lookup";

export interface BlockedRemoval {
  field_id: string;
  slug: string;
  label: string;
  references: TemplateRef[];
}

export function diffRemovedFields(
  prior: FormConfig | null,
  next: FormConfig,
): FormField[] {
  if (!prior) return [];
  const nextIds = new Set<string>();
  for (const s of next.sections) {
    for (const f of s.fields) nextIds.add(f.id);
  }
  const removed: FormField[] = [];
  for (const s of prior.sections) {
    for (const f of s.fields) {
      if (!nextIds.has(f.id)) removed.push(f);
    }
  }
  return removed;
}

export function fieldSlug(field: FormField): string {
  return field.merge_field_slug ?? field.id;
}

export async function findBlockedRemovals(
  supabase: SupabaseClient,
  prior: FormConfig | null,
  next: FormConfig,
): Promise<BlockedRemoval[]> {
  const removed = diffRemovedFields(prior, next);
  if (removed.length === 0) return [];

  const slugs = [...new Set(removed.map(fieldSlug))];
  const usage = await findReferencingTemplates(supabase, slugs);

  const blocked: BlockedRemoval[] = [];
  for (const field of removed) {
    const slug = fieldSlug(field);
    const refs = usage[slug] ?? [];
    if (refs.length > 0) {
      blocked.push({
        field_id: field.id,
        slug,
        label: field.label,
        references: refs,
      });
    }
  }
  return blocked;
}
