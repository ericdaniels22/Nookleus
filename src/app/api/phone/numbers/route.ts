import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import { createTwilioClient, provisionNumber } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 3 (#307) — Shared-number provisioning.
//
// Two endpoints:
//   GET  — list every phone_numbers row in the active org. Gated on
//          view_phone (the broadest phone perm). The User-client RLS from
//          migration-307 already returns the right set; this route is a
//          thin pass-through.
//   POST — provision a new number on Twilio, then INSERT the row. Slice 3
//          only lands Shared numbers (kind='shared', user_id=null). The
//          admin-only rule is enforced by `phone-event-access.canManage`;
//          the wrapper's view_phone gate is the wider door.
//
// Ordering: Twilio first, DB second. If the DB write fails after Twilio
// succeeded, we surface a 500 and the admin can re-run; we'd rather have
// an unattached number on Twilio (visible in their dashboard, releasable
// by a follow-up call) than a row claiming a number we never provisioned.

const PHONE_NUMBER_FIELDS =
  "id, organization_id, twilio_sid, e164, label, kind, user_id, inbound_rule, voicemail_greeting_url, monthly_cost_cents, is_active, released_at, created_at, updated_at";

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (_request, ctx) => {
    const { data, error } = await ctx.supabase
      .from("phone_numbers")
      .select(PHONE_NUMBER_FIELDS)
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { phoneNumber?: string; label?: string }
      | null;
    const phoneNumber = body?.phoneNumber;
    const label = body?.label;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return NextResponse.json(
        { error: "phoneNumber (E.164) is required" },
        { status: 400 },
      );
    }

    // ADR 0003 admin-only Shared rule, delegated to the access module. The
    // route never re-implements the matrix; it just composes the caller.
    const allowed = canManage(
      {
        userId: ctx.userId,
        organizationId: ctx.orgId ?? "",
        role: ctx.role,
      },
      { kind: "shared", organizationId: ctx.orgId ?? "", userId: null },
    );
    if (!allowed) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Twilio first. If this throws (number not available, account out of
    // funds, etc.) we surface 502 — the row is never inserted, so the
    // caller can simply retry without DB cleanup.
    let provisioned: { sid: string; phoneNumber: string };
    try {
      provisioned = await provisionNumber(createTwilioClient(), phoneNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json(
        { error: `Twilio: ${message}` },
        { status: 502 },
      );
    }

    // Service client: the route is admin-only and slice 3 doesn't yet
    // wire the User-client INSERT path end-to-end. The migration-307 RLS
    // would accept this insert too; we use the service client so the
    // failure mode is "DB error", not "RLS denial misread as 500".
    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .insert({
        organization_id: ctx.orgId,
        twilio_sid: provisioned.sid,
        e164: provisioned.phoneNumber,
        label: label ?? null,
        kind: "shared",
        user_id: null,
      })
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  },
);
