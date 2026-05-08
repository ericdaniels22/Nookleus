// POST /api/estimates/[id]/restore — pull an estimate back out of the trash.
// Clears deleted_at + delete_reason. Idempotent — already-active rows are
// no-ops and still write a (possibly redundant) audit row, which is fine.

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
  const gate = await requirePermission(supabase, "manage_estimates");
  if (!gate.ok) return gate.response;

  const { data: row } = await supabase
    .from("estimates")
    .select("id, organization_id, estimate_number")
    .eq("id", id)
    .maybeSingle<{ id: string; organization_id: string; estimate_number: string }>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error: updErr } = await supabase
    .from("estimates")
    .update({ deleted_at: null, delete_reason: null })
    .eq("id", id);
  if (updErr) return apiDbError(updErr.message, "POST /api/estimates/[id]/restore update");

  const { data: { user } } = await supabase.auth.getUser();
  const { error: auditErr } = await supabase.from("contract_events").insert({
    organization_id: row.organization_id,
    contract_id: null,
    signer_id: null,
    event_type: "estimate_restored",
    metadata: {
      estimate_id: row.id,
      estimate_number: row.estimate_number,
      actor_email: user?.email ?? null,
      restored_at: new Date().toISOString(),
    },
  });
  if (auditErr) console.warn("[api] estimate_restored audit insert failed:", auditErr.message);

  return NextResponse.json({ ok: true });
}
