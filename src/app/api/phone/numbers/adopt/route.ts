import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import { parseInboundRule } from "@/lib/phone/parse-inbound-rule";
import type { InboundRule } from "@/lib/phone/route-shared-call";
import { adoptPortedNumber, createTwilioClient } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 14 (#318) — adopt an already-ported number.
//
// POST /api/phone/numbers/adopt
//   Register a number whose carrier port onto the Twilio account has already
//   completed — the legacy CallRail line, or any DID transferred in. The
//   provision route (`POST /api/phone/numbers`) BUYS a new number via
//   `incomingPhoneNumbers.create`; this route buys NOTHING. It looks up the
//   existing Twilio SID with `adoptPortedNumber` and inserts the Shared row
//   pointing at it, so the line the business already owns is wired into
//   Nookleus without a second purchase or a duplicate number.
//
// Like the provision route, Shared numbers are admin-only (canManage,
// ADR 0003) and the inbound rule defaults to ring-all — matching the
// all-hands behavior the CallRail line had before the port.
//
// Ordering mirrors the provision route: Twilio lookup first, DB insert
// second. A lookup failure (port not landed, auth) surfaces 502 with no row
// written, so the admin can retry once the port completes without DB cleanup.

const PHONE_NUMBER_FIELDS =
  "id, organization_id, twilio_sid, e164, label, kind, user_id, inbound_rule, voicemail_greeting_url, monthly_cost_cents, is_active, released_at, created_at, updated_at";

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { phoneNumber?: string; label?: string; inbound_rule?: unknown }
      | null;
    const phoneNumber = body?.phoneNumber;
    const label = body?.label;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return NextResponse.json(
        { error: "phoneNumber (E.164) is required" },
        { status: 400 },
      );
    }

    // ADR 0003 admin-only Shared rule — adopted numbers are Shared.
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

    // A ported CallRail line rang everyone; default the inbound rule to
    // ring-all so adoption preserves that all-hands behavior. A caller may
    // override it, but only through the same parseInboundRule trust boundary
    // the PATCH editor uses — a malformed shape is a 400 client error and
    // never reaches Twilio (input is validated before the side effect).
    let inboundRule: InboundRule = { kind: "ring-all", users: [] };
    if (body?.inbound_rule !== undefined && body?.inbound_rule !== null) {
      const parsed = parseInboundRule(body.inbound_rule);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      inboundRule = parsed.rule;
    }

    // Twilio lookup first. A throw here (port not landed on the account yet,
    // auth failure) surfaces 502 — the row is never inserted, so the admin
    // can retry once the port completes without any DB cleanup.
    let adopted: { sid: string; phoneNumber: string };
    try {
      adopted = await adoptPortedNumber(createTwilioClient(), phoneNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json({ error: `Twilio: ${message}` }, { status: 502 });
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .insert({
        organization_id: ctx.orgId,
        twilio_sid: adopted.sid,
        e164: adopted.phoneNumber,
        label: label ?? null,
        kind: "shared",
        user_id: null,
        inbound_rule: inboundRule,
      })
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  },
);
