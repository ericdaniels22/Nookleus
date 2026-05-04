// src/lib/pdf-presets.ts — DB-facing CRUD for pdf_presets.
// All callers must pass an org-scoped supabase client; RLS does final enforcement.
//
// Error-string contract (route layer matches by message):
//   - "preset not found"            → routes map to 404
//   - "cannot delete default preset"→ routes map to 409
//   Other thrown messages are 5xx; routes redact them via apiError.
//   Do not edit these two strings without updating every route handler that
//   relies on them.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PdfPreset, PdfPresetCreatePayload, PdfPresetUpdatePayload, DocumentType,
} from "@/lib/types";

const TABLE = "pdf_presets";

export async function listPresets(
  supabase: SupabaseClient,
  documentType?: DocumentType,
): Promise<PdfPreset[]> {
  let q = supabase.from(TABLE).select("*").order("name", { ascending: true });
  if (documentType) q = q.eq("document_type", documentType);
  const { data, error } = await q;
  if (error) throw new Error(`list pdf_presets failed: ${error.message}`);
  return (data ?? []) as PdfPreset[];
}

export async function getPreset(supabase: SupabaseClient, id: string): Promise<PdfPreset | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle<PdfPreset>();
  if (error) throw new Error(`get pdf_preset failed: ${error.message}`);
  return data ?? null;
}

export async function getDefaultPreset(
  supabase: SupabaseClient,
  documentType: DocumentType,
): Promise<PdfPreset | null> {
  const { data, error } = await supabase
    .from(TABLE).select("*")
    .eq("document_type", documentType)
    .eq("is_default", true)
    .maybeSingle<PdfPreset>();
  if (error) throw new Error(`get default pdf_preset failed: ${error.message}`);
  return data ?? null;
}

export async function createPreset(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  payload: PdfPresetCreatePayload,
): Promise<PdfPreset> {
  // If is_default=true, atomically clear any existing default for this (org, doc_type).
  if (payload.is_default) {
    const { error: clearErr } = await supabase.from(TABLE)
      .update({ is_default: false })
      .eq("organization_id", orgId)
      .eq("document_type", payload.document_type)
      .eq("is_default", true);
    if (clearErr) throw new Error(`clear default failed: ${clearErr.message}`);
  }
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...payload, organization_id: orgId, created_by: userId })
    .select("*")
    .single<PdfPreset>();
  if (error) throw new Error(`create pdf_preset failed: ${error.message}`);
  return data;
}

export async function updatePreset(
  supabase: SupabaseClient,
  id: string,
  payload: PdfPresetUpdatePayload,
): Promise<PdfPreset> {
  // If flipping is_default → true, clear the prior default for the same (org, doc_type).
  // Read the row first to know which (org, doc_type) we're operating on.
  // `=== true` (not truthy): payload.is_default may be undefined on a partial
  // update — only an explicit `true` should trigger the prior-default clear.
  if (payload.is_default === true) {
    const current = await getPreset(supabase, id);
    if (!current) throw new Error("preset not found");
    const { error: clearErr } = await supabase.from(TABLE)
      .update({ is_default: false })
      .eq("organization_id", current.organization_id)
      .eq("document_type", current.document_type)
      .eq("is_default", true)
      .neq("id", id);
    if (clearErr) throw new Error(`clear default failed: ${clearErr.message}`);
  }
  const { data, error } = await supabase.from(TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single<PdfPreset>();
  if (error) throw new Error(`update pdf_preset failed: ${error.message}`);
  return data;
}

export async function deletePreset(supabase: SupabaseClient, id: string): Promise<void> {
  // Refuse if is_default. UI hides the button but we double-check at the DB layer.
  const current = await getPreset(supabase, id);
  if (!current) throw new Error("preset not found");
  if (current.is_default) throw new Error("cannot delete default preset");
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`delete pdf_preset failed: ${error.message}`);
}
