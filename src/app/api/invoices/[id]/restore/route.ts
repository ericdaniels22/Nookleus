import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { apiDbError } from "@/lib/api-errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_invoices");
  if (!gate.ok) return gate.response;

  const { data: row } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: updErr } = await supabase
    .from("invoices")
    .update({ deleted_at: null, delete_reason: null })
    .eq("id", id);
  if (updErr) return apiDbError(updErr.message, "POST /api/invoices/[id]/restore update");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "invoice_restored",
    metadata: {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      actor_email: user?.email ?? null,
      restored_at: new Date().toISOString(),
    },
  });
  if (auditErr) console.warn("[api] invoice_restored audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
