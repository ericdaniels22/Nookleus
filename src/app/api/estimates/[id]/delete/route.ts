// POST /api/estimates/[id]/delete — soft-delete an estimate (move to trash).
// Sets deleted_at = now() and delete_reason. The row stays in the DB and
// hides from active queries until either restored, hard-purged, or
// auto-purged after 30 days by GET /api/estimates/trash.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

interface Body { delete_reason?: string }

export const POST = withRequestContext(
  { permission: "manage_estimates" },
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as Body;
    const reason = body.delete_reason?.trim() || null;

    // Fetch context for the audit row before mutating.
    const { data: row } = await supabase
      .from("estimates")
      .select("id, organization_id, estimate_number, deleted_at")
      .eq("id", id)
      .maybeSingle<{
        id: string;
        organization_id: string;
        estimate_number: string;
        deleted_at: string | null;
      }>();
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.deleted_at !== null) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("estimates")
      .update({ deleted_at: now, delete_reason: reason })
      .eq("id", id)
      .is("deleted_at", null);
    if (updErr) return apiDbError(updErr.message, "POST /api/estimates/[id]/delete update");

    // Audit — best effort.
    const { data: { user } } = await supabase.auth.getUser();
    const { error: auditErr } = await supabase.from("contract_events").insert({
      organization_id: row.organization_id,
      contract_id: null,
      signer_id: null,
      event_type: "estimate_trashed",
      metadata: {
        estimate_id: row.id,
        estimate_number: row.estimate_number,
        delete_reason: reason,
        actor_email: user?.email ?? null,
        deleted_at: now,
      },
    });
    if (auditErr) console.warn("[api] estimate_trashed audit insert failed:", auditErr.message);

    return NextResponse.json({ ok: true });
  },
);
