import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { VIEW_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";

// GET /api/referral-partners/[id]/jobs — slice C2 (#301).
//
// Returns the Jobs attributed to this Referral Partner, newest first by
// intake date (`created_at`), excluding trashed Jobs by default. Powers
// the "Jobs sent" section of the Referral Partner Worksheet.
//
// Org-scoping rides on RLS: a partner id from another Organization
// resolves to no `referral_partners` row and the route returns 404
// before any `jobs` SELECT happens. Trashed Partners are NOT 404'd —
// the Worksheet must keep loading the section during the 30-day grace
// period (mirrors slice B's link-preservation behaviour, PRD #297).
export const GET = withRequestContext(
  VIEW_REFERRAL_PARTNERS,
  async (
    _request,
    { supabase },
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;

    // Existence + Org-scope check — no `deleted_at` filter, so a trashed
    // Partner inside the 30-day grace period still loads its Jobs list.
    const { data: partner, error: partnerError } = await supabase
      .from("referral_partners")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (partnerError) {
      return apiDbError(
        partnerError.message,
        "GET /api/referral-partners/[id]/jobs partner",
      );
    }
    if (!partner) {
      return NextResponse.json(
        { error: "Referral Partner not found" },
        { status: 404 },
      );
    }

    // SQL drives the filter and the sort — the partial index
    // `(referral_partner_id) WHERE deleted_at IS NULL` carries the
    // workload. The pure rule in `src/lib/referral-partners/jobs.ts`
    // (slice C1) is the unit-tested specification of the same shape.
    const { data: rows, error: jobsError } = await supabase
      .from("jobs")
      .select("id, property_address, status, created_at")
      .eq("referral_partner_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (jobsError) {
      return apiDbError(
        jobsError.message,
        "GET /api/referral-partners/[id]/jobs jobs",
      );
    }

    // Project to the documented contract so a future SELECT * mistake
    // can't leak columns to the client.
    const jobs = ((rows ?? []) as ReferralPartnerJobRow[]).map((j) => ({
      id: j.id,
      property_address: j.property_address,
      status: j.status,
      created_at: j.created_at,
    }));
    return NextResponse.json({ jobs });
  },
);

interface ReferralPartnerJobRow {
  id: string;
  property_address: string;
  status: string;
  created_at: string;
}
