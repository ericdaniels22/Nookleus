// POST /api/invoices/[id]/delete — soft-delete an invoice (move to trash).
// Mirror of POST /api/estimates/[id]/delete; see that file for design notes.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

interface Body { delete_reason?: string }

export const POST = withRequestContext(
  { permission: "manage_invoices" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as Body;
    const reason = body.delete_reason?.trim() || null;

    const { data: row } = await supabase
      .from("invoices")
      .select("id, organization_id, invoice_number, deleted_at")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        organization_id: string;
        invoice_number: string;
        deleted_at: string | null;
      }>();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.deleted_at !== null) return NextResponse.json({ error: "not found" }, { status: 404 });

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ deleted_at: now, delete_reason: reason })
      .eq("id", id)
      .is("deleted_at", null);
    if (updErr) return apiDbError(updErr.message, "POST /api/invoices/[id]/delete update");

    const { data: { user } } = await supabase.auth.getUser();
    const { error: auditErr } = await supabase.from("contract_events").insert({
      organization_id: row.organization_id,
      contract_id: null,
      signer_id: null,
      event_type: "invoice_trashed",
      metadata: {
        invoice_id: row.id,
        invoice_number: row.invoice_number,
        delete_reason: reason,
        actor_email: user?.email ?? null,
        deleted_at: now,
      },
    });
    if (auditErr) console.warn("[api] invoice_trashed audit insert failed:", auditErr.message);

    return NextResponse.json({ ok: true });
  },
);
