import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import {
  buildNewTargetPayload,
  isValidNewTarget,
  type NewTargetInput,
} from "@/lib/referral-partner-form";
import {
  EDIT_REFERRAL_PARTNERS,
  VIEW_REFERRAL_PARTNERS,
} from "@/lib/referral-partners/permission";

// GET /api/referral-partners — list every Referral Partner in the Active
// Organization that isn't in the soft-delete bin. Each row carries a
// lifetime `job_count` of non-trashed Jobs attributed to that partner
// (slice C1 / #300). The count query filters `deleted_at IS NULL` so it
// uses the partial index `(referral_partner_id) WHERE deleted_at IS NULL`
// added in slice B's migration. Gated to admin / crew_lead; crew_member
// receives 403.
export const GET = withRequestContext(
  VIEW_REFERRAL_PARTNERS,
  async (_request, { supabase }) => {
    const { data: partners, error } = await supabase
      .from("referral_partners")
      .select("*")
      .is("deleted_at", null)
      .order("company_name", { ascending: true });
    if (error) return apiDbError(error.message, "GET /api/referral-partners list");

    const rows = (partners ?? []) as Array<{ id: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ referral_partners: [] });
    }

    // One batched read — `referral_partner_id IN (...)` AND `deleted_at IS
    // NULL`. The aggregate is computed in the route, but the filtering
    // happens in SQL and rides the partial index.
    const partnerIds = rows.map((r) => r.id);
    const { data: jobRows, error: jobsError } = await supabase
      .from("jobs")
      .select("referral_partner_id")
      .in("referral_partner_id", partnerIds)
      .is("deleted_at", null);
    if (jobsError) {
      return apiDbError(jobsError.message, "GET /api/referral-partners job_count");
    }

    const counts = new Map<string, number>();
    for (const { referral_partner_id } of (jobRows ?? []) as Array<{
      referral_partner_id: string | null;
    }>) {
      if (!referral_partner_id) continue;
      counts.set(referral_partner_id, (counts.get(referral_partner_id) ?? 0) + 1);
    }

    const withCounts = rows.map((row) => ({
      ...row,
      job_count: counts.get(row.id) ?? 0,
    }));
    return NextResponse.json({ referral_partners: withCounts });
  },
);

// POST /api/referral-partners — create a new Target. Body matches the
// NewTargetInput shape (5 fields). Validation + payload shape live in the
// pure `referral-partner-form` module so this route stays a thin adapter.
export const POST = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (request, { supabase, orgId }) => {
    const raw = (await request.json()) as Partial<NewTargetInput>;
    const input: NewTargetInput = {
      company_name: raw.company_name ?? "",
      office_phone: raw.office_phone ?? "",
      lead_source: raw.lead_source ?? "",
      industry: raw.industry ?? "",
      notes: raw.notes ?? "",
    };
    if (!isValidNewTarget(input)) {
      return NextResponse.json(
        { error: "company_name is required" },
        { status: 400 },
      );
    }
    if (!orgId) {
      // `roles` rule guarantees a non-null orgId on success, but the type
      // exposes a nullable orgId; this is defensive.
      return NextResponse.json(
        { error: "No active organization" },
        { status: 400 },
      );
    }
    const payload = buildNewTargetPayload(input, orgId);
    const { data, error } = await supabase
      .from("referral_partners")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      return apiDbError(error.message, "POST /api/referral-partners insert");
    }
    return NextResponse.json({ referral_partner: data }, { status: 201 });
  },
);
