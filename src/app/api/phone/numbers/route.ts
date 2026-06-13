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

interface ExistingNumberRow {
  id: string;
  user_id: string | null;
  released_at: string | null;
}

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
      | { phoneNumber?: string; label?: string; kind?: string }
      | null;
    const phoneNumber = body?.phoneNumber;
    const label = body?.label;
    // Slice 3 only provisioned Shared numbers; slice 13 (#317) makes the
    // same endpoint the Crew Lead's self-service Personal claim. A Personal
    // number is always owned by the caller — the route never honors a
    // body-supplied owner, so a member can only ever claim for themselves.
    const kind = body?.kind === "personal" ? "personal" : "shared";
    const ownerId = kind === "personal" ? ctx.userId : null;

    if (!phoneNumber || typeof phoneNumber !== "string") {
      return NextResponse.json(
        { error: "phoneNumber (E.164) is required" },
        { status: 400 },
      );
    }

    // ADR 0003 manage rule, delegated to the access module. The route never
    // re-implements the matrix; it just composes the caller and the proposed
    // number. Shared → admin-only; Personal-owned-by-self → allowed for any
    // member (the view_phone wrapper gate is the real door).
    const allowed = canManage(
      {
        userId: ctx.userId,
        organizationId: ctx.orgId ?? "",
        role: ctx.role,
      },
      { kind, organizationId: ctx.orgId ?? "", userId: ownerId },
    );
    if (!allowed) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Re-claim revive (#317). Offboarding releases a number (the release
    // route sets released_at + is_active=false) but KEEPS the row, because
    // e164 carries a UNIQUE index across ALL rows — released included — so a
    // fresh INSERT of the same number would collide. If a released row for
    // this e164 already exists in the org we revive it in place instead.
    // The lookup uses the service client because a departed teammate's
    // released Personal row is RLS-hidden from the new claimant's User
    // client; canManage above is the access gate either way.
    const { data: existing } = await ctx.serviceClient!
      .from("phone_numbers")
      .select("id, user_id, released_at")
      .eq("organization_id", ctx.orgId)
      .eq("e164", phoneNumber)
      .maybeSingle<ExistingNumberRow>();
    const reviveRow =
      existing && existing.released_at !== null ? existing : null;

    // Twilio first. If this throws (number not available, account out of
    // funds, etc.) we surface 502 — no DB write happens, so the caller can
    // simply retry without cleanup. Re-claiming re-purchases the same e164,
    // yielding a fresh sid we re-point the revived row at.
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

    // Service client: canManage above is the access gate, so we write with
    // the service client and let the failure mode be "DB error", not "RLS
    // denial misread as 500". The migration-307 RLS would accept both the
    // admin Shared insert and the owner Personal insert too.
    if (reviveRow) {
      const { data, error } = await ctx.serviceClient!
        .from("phone_numbers")
        .update({
          twilio_sid: provisioned.sid,
          e164: provisioned.phoneNumber,
          label: label ?? null,
          kind,
          user_id: ownerId,
          is_active: true,
          released_at: null,
        })
        .eq("id", reviveRow.id)
        .select(PHONE_NUMBER_FIELDS)
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      // 200 (revived an existing row), with the prior owner so the claim UI
      // can warn that the line was previously held by a departed teammate.
      return NextResponse.json(
        { ...data, previously_owned_by: reviveRow.user_id ?? null },
        { status: 200 },
      );
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .insert({
        organization_id: ctx.orgId,
        twilio_sid: provisioned.sid,
        e164: provisioned.phoneNumber,
        label: label ?? null,
        kind,
        user_id: ownerId,
      })
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  },
);
