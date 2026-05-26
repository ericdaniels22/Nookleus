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
// Organization that isn't in the soft-delete bin. Gated to admin / crew_lead;
// crew_member receives 403.
export const GET = withRequestContext(
  VIEW_REFERRAL_PARTNERS,
  async (_request, { supabase }) => {
    const { data, error } = await supabase
      .from("referral_partners")
      .select("*")
      .is("deleted_at", null)
      .order("company_name", { ascending: true });
    if (error) return apiDbError(error.message, "GET /api/referral-partners list");
    return NextResponse.json({ referral_partners: data ?? [] });
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
