import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeOrFilterValue } from "@/lib/postgrest";
import type { ItemLibraryItem, ItemCategory } from "@/lib/types";

export interface ListItemsFilters {
  search?: string;
  category?: ItemCategory;
  damage_type?: string;
  is_active?: boolean;
}

export async function listItems(
  filters: ListItemsFilters,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem[]> {
  let q = supabase.from("item_library").select("*");
  if (filters.category) q = q.eq("category", filters.category);
  if (typeof filters.is_active === "boolean") q = q.eq("is_active", filters.is_active);
  if (filters.damage_type) {
    // damage_type_tags is jsonb, not text[]; supabase-js's .contains() with a
    // JS array serializes to Postgres array literal `{x}`, which the server
    // rejects as "invalid input syntax for type json". Pass a JSON-formatted
    // string so PostgREST emits `cs.["x"]` instead.
    q = q.contains("damage_type_tags", JSON.stringify([filters.damage_type]));
  }
  if (filters.search) {
    const term = escapeOrFilterValue(`%${filters.search}%`);
    q = q.or(`name.ilike.${term},description.ilike.${term},code.ilike.${term}`);
  }
  q = q.order("sort_order", { ascending: true }).order("name", { ascending: true });
  const { data, error } = await q.returns<ItemLibraryItem[]>();
  if (error) throw new Error(`listItems failed: ${error.message}`);
  return data ?? [];
}

export async function getItem(
  id: string,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem | null> {
  const { data, error } = await supabase
    .from("item_library")
    .select("*")
    .eq("id", id)
    .maybeSingle<ItemLibraryItem>();
  if (error) throw new Error(`getItem failed: ${error.message}`);
  return data;
}

export interface CreateItemInput {
  name: string;
  description: string;
  code?: string | null;
  category: ItemCategory;
  default_quantity: number;
  default_unit?: string | null;
  unit_price: number;
  damage_type_tags?: string[];
  section_tags?: string[];
}

export async function createItem(
  input: CreateItemInput,
  organizationId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem> {
  const { data, error } = await supabase
    .from("item_library")
    .insert({
      organization_id: organizationId,
      created_by: userId,
      name: input.name,
      description: input.description,
      code: input.code ?? null,
      category: input.category,
      default_quantity: input.default_quantity,
      default_unit: input.default_unit ?? null,
      unit_price: input.unit_price,
      damage_type_tags: input.damage_type_tags ?? [],
      section_tags: input.section_tags ?? [],
    })
    .select("*")
    .single<ItemLibraryItem>();
  if (error) throw new Error(`createItem failed: ${error.message}`);
  return data;
}

export type UpdateItemInput = Partial<CreateItemInput>;

export async function updateItem(
  id: string,
  input: UpdateItemInput,
  supabase: SupabaseClient,
): Promise<ItemLibraryItem> {
  const { data, error } = await supabase
    .from("item_library")
    .update(input)
    .eq("id", id)
    .select("*")
    .single<ItemLibraryItem>();
  if (error) throw new Error(`updateItem failed: ${error.message}`);
  return data;
}

export async function deactivateItem(id: string, supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("item_library").update({ is_active: false }).eq("id", id);
  if (error) throw new Error(`deactivateItem failed: ${error.message}`);
}

export async function reactivateItem(id: string, supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("item_library").update({ is_active: true }).eq("id", id);
  if (error) throw new Error(`reactivateItem failed: ${error.message}`);
}
