// POST /api/referral-partners/[id]/restore — pull a Referral Partner back
// out of the Trash. Clears `referral_partners.deleted_at`. The Trash UI's
// "Restore" button is the only caller (issue #256).
//
// Gated on EDIT_REFERRAL_PARTNERS — crew_member 403s. Mirrors the Build 66
// jobs restore shape.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";

export const POST = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (_request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    // We only restore rows currently in the Trash — restoring an already-
    // active row is a no-op (returns 404, matching the cross-tenant shape).
    const { data, error } = await supabase
      .from("referral_partners")
      .update({ deleted_at: null })
      .eq("id", id)
      .not("deleted_at", "is", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return apiDbError(error.message, "POST /api/referral-partners/[id]/restore");
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
