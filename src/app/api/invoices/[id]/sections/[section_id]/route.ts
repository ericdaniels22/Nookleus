import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import { assertNotTrashed } from "@/lib/api/assert-not-trashed";
import { touchEntity } from "@/lib/builder-shared";
import { recalculateInvoiceTotals } from "@/lib/invoices";

interface PutBody {
  title?: string;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; section_id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) return auth.response;

  const { id, section_id } = await context.params;

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashed = assertNotTrashed(invoiceRow);
  if (trashed) return trashed;

  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) patch.title = body.title;
    const { data, error } = await supabase
      .from("invoice_sections")
      .update(patch)
      .eq("id", section_id)
      .eq("invoice_id", id)
      .select()
      .single();
    if (error) throw error;
    await touchEntity(supabase, "invoices", id);
    return NextResponse.json(data);
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]/sections/[section_id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; section_id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) return auth.response;

  const { id, section_id } = await context.params;

  const { data: invoiceRowDel } = await supabase
    .from("invoices")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle<{ deleted_at: string | null }>();
  const trashedDel = assertNotTrashed(invoiceRowDel);
  if (trashedDel) return trashedDel;

  try {
    const { error } = await supabase
      .from("invoice_sections")
      .delete()
      .eq("id", section_id)
      .eq("invoice_id", id);
    if (error) throw error;
    await recalculateInvoiceTotals(supabase, id); // line items cascade-deleted via FK
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "DELETE /api/invoices/[id]/sections/[section_id]");
  }
}
