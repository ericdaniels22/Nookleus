import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import { parseInboundRule } from "@/lib/phone/parse-inbound-rule";

// PRD #304 — Nookleus Phone. Slice 8 (#312) — configure a Shared number's
// inbound rule.
//
// PATCH /api/phone/numbers/[id]
// The Settings → Phone editor saves a Shared number's answer rule here.
//
// Flow (mirrors the release route's gate order):
//   1. Look up the row via the Service client (RLS bypassed — the admin
//      gate is enforced below, not by RLS).
//   2. Missing / cross-org → 404 (privacy-preserving; same convention as
//      the release route and the email-access routes).
//   3. canManage → 403 (Shared is admin-only, ADR 0003).
//   4. Personal numbers always go to voicemail and never reach
//      decideShared (ADR 0005/0006), so a rule cannot be configured on
//      one → 409. This is checked AFTER canManage so a non-admin never
//      learns the number's kind.
//   5. Validate the body's `inbound_rule` through the parseInboundRule
//      trust boundary → 400 on a malformed shape; only the four routable
//      shapes ever touch the jsonb column.
//   6. Persist and return the updated row.

const PHONE_NUMBER_FIELDS =
  "id, organization_id, twilio_sid, e164, label, kind, user_id, inbound_rule, voicemail_greeting_url, monthly_cost_cents, is_active, released_at, created_at, updated_at";

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  kind: "shared" | "personal";
  user_id: string | null;
}

export const PATCH = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { data: row } = await ctx.serviceClient!
      .from("phone_numbers")
      .select("id, organization_id, kind, user_id")
      .eq("id", id)
      .maybeSingle<PhoneNumberRow>();

    // Cross-org callers cannot prove the row exists → 404, the same
    // privacy-preserving response as a genuinely missing row.
    if (!row || row.organization_id !== ctx.orgId) {
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
    if (!allowed) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    // Inbound rules are Shared-only. A Personal number's inbound rule is
    // implicitly "voicemail" and is not editable.
    if (row.kind !== "shared") {
      return NextResponse.json(
        { error: "Inbound rules are only configurable on Shared numbers" },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { inbound_rule?: unknown }
      | null;

    const parsed = parseInboundRule(body?.inbound_rule);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.serviceClient!
      .from("phone_numbers")
      .update({
        inbound_rule: parsed.rule,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(PHONE_NUMBER_FIELDS)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  },
);
