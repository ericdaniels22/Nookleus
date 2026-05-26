// POST /api/referral-partners/[id]/delete — soft-delete a Referral Partner
// (move it into the 30-day Trash). Sets `referral_partners.deleted_at = now()`;
// the row stays in the DB and continues to hide from active queries until
// either restored (POST /restore) or hard-deleted (DELETE /api/referral-
// partners/[id]) or auto-purged after 30 days by GET /api/referral-partners/
// trash.
//
// Gated on EDIT_REFERRAL_PARTNERS — a crew_member receives 403 before the
// row is even located. Mirrors the Build 66 jobs soft-delete shape so the
// platform has one trash pattern across surfaces (PRD #249 #23, issue #256).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";

export const POST = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (_request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    // RLS scopes the update to the Active Organization. The .is(...) guard
    // makes the second click on a partial-network double-click a no-op
    // rather than re-stamping deleted_at; the maybeSingle resolves to null
    // and we 404 (same cross-tenant shape as PATCH).
    const { data, error } = await supabase
      .from("referral_partners")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return apiDbError(error.message, "POST /api/referral-partners/[id]/delete");
    }
    if (!data) {
      return NextResponse.json(
        { error: "Referral Partner not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  },
);
