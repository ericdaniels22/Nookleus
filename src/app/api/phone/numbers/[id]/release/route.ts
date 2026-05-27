import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import { createTwilioClient, releaseNumber } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 3 (#307) — release a Shared number.
//
// Flow:
//   1. Look up the row via the Service client (RLS bypassed — admins need
//      to see Personal numbers they don't own for offboarding per ADR
//      0003, even though slice 3 only ships Shared).
//   2. Run the access-decision module's `canManage` against the (caller,
//      row). canSee-false → 404; canManage-false → 403. Cross-org callers
//      are denied at the organizationId check inside canManage and surface
//      as 404 — same convention as the email-access route (#98/#101/#119).
//   3. If the row is already released_at, surface 409 — Twilio rejects
//      remove() on an already-removed SID, and we'd rather not paper over
//      that with an idempotent 200 (the admin's "Release" click expects
//      something to actually have happened).
//   4. Twilio remove() first. If it throws, return 502 and leave the row
//      untouched — the admin can retry. If Twilio confirms, set
//      released_at on the row.

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  twilio_sid: string;
  kind: "shared" | "personal";
  user_id: string | null;
  released_at: string | null;
}

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: row } = await ctx.serviceClient!
      .from("phone_numbers")
      .select(
        "id, organization_id, twilio_sid, kind, user_id, released_at",
      )
      .eq("id", id)
      .maybeSingle<PhoneNumberRow>();

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = canManage(
      {
        userId: ctx.userId,
        organizationId: ctx.orgId ?? "",
        role: ctx.role,
      },
      {
        kind: row.kind,
        organizationId: row.organization_id,
        userId: row.user_id,
      },
    );
    // Cross-org caller / wrong role: same 404 vs 403 split as the email
    // route. The organizationId branch of canManage is the cross-org
    // short-circuit; outside the caller's org, we cannot prove the row
    // exists, so 404 is the privacy-preserving response.
    if (row.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    if (row.released_at) {
      return NextResponse.json(
        { error: "Number is already released" },
        { status: 409 },
      );
    }

    try {
      await releaseNumber(createTwilioClient(), row.twilio_sid);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json(
        { error: `Twilio: ${message}` },
        { status: 502 },
      );
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .update({ released_at: new Date().toISOString(), is_active: false })
      .eq("id", id)
      .select(
        "id, organization_id, twilio_sid, e164, label, kind, user_id, released_at, is_active",
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  },
);
