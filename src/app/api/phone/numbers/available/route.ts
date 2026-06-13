import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  createTwilioClient,
  listAvailableLocalNumbers,
} from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 3 (#307) — number-picker proxy.
//
// GET /api/phone/numbers/available?areaCode=512
// Step 2 of both number-claim flows: given an area code, show the caller
// the list of available local numbers Twilio returns. Gated on view_phone
// alone — slice 3 narrowed this admin-only because only admins could
// provision, but slice 13 (#317) makes the same picker serve the Crew
// Lead's self-service Personal claim. The downstream POST still enforces
// the ADR-0005 matrix per kind (Shared → admin; Personal → owner-self), so
// the picker need only confirm the caller is in the phone product at all.

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (request) => {
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
