// GET /api/invoices/[id]    — invoice + sections + items + job summary
// PUT /api/invoices/[id]    — entity-level edit (title, statements, markup, discount, tax, dates)
// DELETE /api/invoices/[id] — hard-purge (67d; soft-delete lives at POST /api/invoices/[id]/delete)

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";
import { checkSnapshot } from "@/lib/builder-shared";
import { getInvoiceWithContents, recalculateInvoiceTotals } from "@/lib/invoices";
import { purgeInvoiceStorage } from "@/lib/documents/purge";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const invoice = await getInvoiceWithContents(supabase, id);
    if (!invoice) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { data: job } = await supabase
      .from("jobs")
      .select("id, job_number, property_address, damage_type, contact_id, contacts:contact_id(first_name, last_name, email)")
      .eq("id", invoice.job_id)
      .maybeSingle();
    return NextResponse.json({ ...invoice, job: job ?? null });
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "GET /api/invoices/[id]");
  }
}

interface PutBody {
  title?: string;
  opening_statement?: string | null;
  closing_statement?: string | null;
  issued_date?: string;
  due_date?: string | null;
  po_number?: string | null;
  memo?: string | null;
  notes?: string | null;
  markup_type?: "percent" | "amount" | "none";
  markup_value?: number;
  discount_type?: "percent" | "amount" | "none";
  discount_value?: number;
  tax_rate?: number;
  updated_at_snapshot?: string;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "edit_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  try {
    const { stale, current } = await checkSnapshot(supabase, "invoices", id, body.updated_at_snapshot);
    if (stale) {
      return NextResponse.json(
        { error: "stale_snapshot", current_updated_at: current },
        { status: current === null ? 404 : 409 },
      );
    }

    const { data: trashedCheck } = await supabase
      .from("invoices")
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle<{ deleted_at: string | null }>();
    if (trashedCheck?.deleted_at) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.opening_statement !== undefined) patch.opening_statement = body.opening_statement;
    if (body.closing_statement !== undefined) patch.closing_statement = body.closing_statement;
    if (body.issued_date !== undefined) patch.issued_date = body.issued_date;
    if (body.due_date !== undefined) patch.due_date = body.due_date;
    if (body.po_number !== undefined) patch.po_number = body.po_number;
    if (body.memo !== undefined) patch.memo = body.memo;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.markup_type !== undefined) patch.markup_type = body.markup_type;
    if (body.markup_value !== undefined) patch.markup_value = Number(body.markup_value);
    if (body.discount_type !== undefined) patch.discount_type = body.discount_type;
    if (body.discount_value !== undefined) patch.discount_value = Number(body.discount_value);
    if (body.tax_rate !== undefined) {
      const tr = Number(body.tax_rate);
      if (!Number.isFinite(tr) || tr < 0 || tr > 100) {
        return NextResponse.json({ error: "tax_rate must be between 0 and 100" }, { status: 400 });
      }
      patch.tax_rate = tr;
    }

    const { data, error } = await supabase.from("invoices").update(patch).eq("id", id).select().single();
    if (error) throw error;

    const adjustmentTouched = body.markup_type !== undefined || body.markup_value !== undefined
      || body.discount_type !== undefined || body.discount_value !== undefined
      || body.tax_rate !== undefined;
    if (adjustmentTouched) await recalculateInvoiceTotals(supabase, id);

    return NextResponse.json(data);
  } catch (e: unknown) {
    return apiDbError(e instanceof Error ? e.message : String(e), "PUT /api/invoices/[id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // 67d: DELETE is now a hard-purge. Soft-delete (the trash flow) lives at
  // POST /api/invoices/[id]/delete.
  const { id } = await context.params;
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_invoices");
  if (!auth.ok) return auth.response;

  const { data: row } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_purged",
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      actor_email: user?.email ?? null,
      purged_at: new Date().toISOString(),
      reason: "force",
    },
  });
  if (auditErr) console.warn("[api] invoice_purged audit insert failed:", auditErr.message);

  const { storageRemoved, storageErrors } = await purgeInvoiceStorage(supabase, id);

  const { error: deleteError } = await supabase.from("invoices").delete().eq("id", id);
  if (deleteError) {
    return apiDbError(deleteError.message, "DELETE /api/invoices/[id] purge", 500);
  }
  return NextResponse.json({ ok: true, storageRemoved, storageErrors });
}
