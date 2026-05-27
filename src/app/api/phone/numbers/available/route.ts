import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { canManage } from "@/lib/phone/phone-event-access";
import {
  createTwilioClient,
  listAvailableLocalNumbers,
} from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 3 (#307) — number-picker proxy.
//
// GET /api/phone/numbers/available?areaCode=512
// The Add Shared Number flow's step 2: given an area code, show the
// caller the list of available local numbers Twilio returns. Admin-only —
// non-admins cannot provision (canManage on Shared = admin-only), so
// gating the search at the same door avoids leaking number availability
// to non-admins who could not act on it anyway.

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (request, ctx) => {
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

    const areaCode = new URL(request.url).searchParams.get("areaCode");
    if (!areaCode) {
      return NextResponse.json(
        { error: "areaCode is required" },
        { status: 400 },
      );
    }

    try {
      const numbers = await listAvailableLocalNumbers(
        createTwilioClient(),
        areaCode,
      );
      return NextResponse.json(numbers);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json(
        { error: `Twilio: ${message}` },
        { status: 502 },
      );
    }
  },
);
