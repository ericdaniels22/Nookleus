import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import { EDIT_REFERRAL_PARTNERS } from "@/lib/referral-partners/permission";
import {
  buildNewReferralContactPayload,
  isValidNewReferralContact,
  type NewReferralContactInput,
} from "@/lib/referral-contact-form";

// POST /api/referral-partners/[id]/contacts — inline "+ Add contact" endpoint
// (PRD #249, issue #255). Creates a `contacts` row with role =
// 'referral_contact' and referral_partner_id pinned to the partner the Call
// Worksheet is open on. Gated on EDIT_REFERRAL_PARTNERS so a crew_member
// receives 403 before the body is parsed.
//
// Validation and payload shape live in the pure `referral-contact-form`
// module so this route stays a thin adapter, matching the New Target POST
// mirror from issue #250.
export const POST = withRequestContext(
  EDIT_REFERRAL_PARTNERS,
  async (
    request,
    { supabase, orgId },
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const raw = (await request.json()) as Partial<NewReferralContactInput>;
    const input: NewReferralContactInput = {
      full_name: raw.full_name ?? "",
      phone: raw.phone ?? "",
      email: raw.email ?? "",
      notes: raw.notes ?? "",
    };
    if (!isValidNewReferralContact(input)) {
      return NextResponse.json(
        { error: "full_name is required" },
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
    const payload = buildNewReferralContactPayload(input, orgId, id);
    const { data, error } = await supabase
      .from("contacts")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      return apiDbError(
        error.message,
        "POST /api/referral-partners/[id]/contacts insert",
      );
    }
    return NextResponse.json({ contact: data }, { status: 201 });
  },
);
