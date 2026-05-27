// DELETE /api/jobs/[id] — hard-delete (force-purge) a job.
// Removes every storage object the job owns (photos, job files, photo
// reports, contracts, expense receipts) then deletes the jobs row, which
// cascades to all child tables with FK ON DELETE CASCADE. Restricted to
// admin/office_staff per the same rule as soft-delete.
//
// PATCH /api/jobs/[id] — Job edit endpoint. Issue #298 introduces it with
// a single editable field (`referral_partner_id`); future job-edit fields
// slot in alongside. Server-side eligibility (ADR-0002) refuses to attach
// anything except a green, not-trashed Referral Partner visible in the
// caller's Active Organization, independent of the picker UI.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { purgeJobStorage } from "@/lib/jobs/purge";
import { eligibilityFor } from "@/lib/referral-partners/eligibility";

export const DELETE = withRequestContext(
  { roles: ["admin", "office_staff"] },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.supabase;

    const { storageRemoved, storageErrors } = await purgeJobStorage(supabase, id);

    const { error: deleteError } = await supabase.from("jobs").delete().eq("id", id);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message, storageRemoved, storageErrors },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, storageRemoved, storageErrors });
  },
);

export const PATCH = withRequestContext(
  {},
  async (request, { supabase }, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const raw = (await request.json()) as Record<string, unknown>;

    if (!("referral_partner_id" in raw)) {
      return NextResponse.json(
        { error: "Body contained no editable fields" },
        { status: 400 },
      );
    }
    const referralPartnerId = raw.referral_partner_id;
    if (referralPartnerId !== null && typeof referralPartnerId !== "string") {
      return NextResponse.json(
        { error: "referral_partner_id must be a string or null" },
        { status: 400 },
      );
    }

    if (referralPartnerId !== null) {
      const { data: partner } = await supabase
        .from("referral_partners")
        .select("id, status, deleted_at")
        .eq("id", referralPartnerId)
        .maybeSingle();
      if (!partner) {
        return NextResponse.json(
          { error: "Referral Partner not eligible: not found in this Organization" },
          { status: 422 },
        );
      }
      const verdict = eligibilityFor({
        status: partner.status,
        deleted_at: partner.deleted_at,
      });
      if (verdict !== "pickable") {
        return NextResponse.json(
          {
            error: `Referral Partner not eligible: Lifecycle status must be 'green' (active) and not trashed`,
          },
          { status: 422 },
        );
      }
    }

    const { data, error } = await supabase
      .from("jobs")
      .update({ referral_partner_id: referralPartnerId })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job: data });
  },
);
