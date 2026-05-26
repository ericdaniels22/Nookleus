import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { buildEditPayload } from "@/lib/referral-partner-edit";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";

// DELETE /api/referral-partners/[id] — hard-delete (force-purge) a Referral
// Partner. The "Delete forever" button on the Trash row is the only UI
// caller; the lazy 30-day sweep in /api/referral-partners/trash issues the
// same DELETE against `referral_partners` directly. Both rely on the same
// FK behaviour: `referral_partner_calls` cascade, `contacts.referral_
// partner_id` set to NULL (the contact rows survive). See PRD #249 user
// story #23 and the build78 migration.
//
// Gated on EDIT_REFERRAL_PARTNERS — crew_member 403s.
export const DELETE = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (_request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { error } = await supabase
      .from("referral_partners")
      .delete()
      .eq("id", id);
    if (error) {
      return apiDbError(error.message, "DELETE /api/referral-partners/[id]");
    }
    return NextResponse.json({ ok: true });
  },
);

// PATCH /api/referral-partners/[id] — the Call Worksheet's edit endpoint
// (PRD #249, issue #253). Updates one or more whitelisted columns on a
// `referral_partners` row, plus the Lifecycle status. Gated on
// EDIT_REFERRAL_PARTNERS — a crew_member receives 403 before the body is
// even parsed. The pure `buildEditPayload` whitelists / normalizes the
// body so this route stays a thin adapter (issue #250's POST mirror).
export const PATCH = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const raw = (await request.json()) as Record<string, unknown>;

    const result = buildEditPayload(raw);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // RLS scopes the update to the Active Organization. An id from another
    // Org (or a soft-deleted partner) resolves to no row — return 404 so
    // the Worksheet can surface the same cross-tenant pattern the rest of
    // the platform uses.
    const { data, error } = await supabase
      .from("referral_partners")
      .update(result.payload)
      .eq("id", id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();
    if (error) {
      return apiDbError(error.message, "PATCH /api/referral-partners/[id]");
    }
    if (!data) {
      return NextResponse.json(
        { error: "Referral Partner not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ referral_partner: data });
  },
);
