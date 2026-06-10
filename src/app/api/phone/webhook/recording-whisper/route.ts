import type { NextRequest } from "next/server";
import {
  validateTwilioSignature,
  buildConsentWhisperTwiml,
} from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 11 (#315) — recording-consent whisper.
//
// On a recorded call, each dialed <Number> carries a `url` pointing here.
// Twilio fetches this TwiML and plays it to the ANSWERING party before
// bridging, so both parties hear the legally-required consent notice (the
// initiating party already heard it via the <Say> before the <Dial>). The
// response is pure, static TwiML — the notice text is the single source of
// truth in recording-consent.ts, built into TwiML by twilio-client (the only
// file allowed to import the Twilio SDK).
//
// Like every Twilio-facing endpoint this is unauthenticated and gated solely
// by the X-Twilio-Signature HMAC — 403 on an invalid signature.

function twimlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(request: NextRequest | Request): Promise<Response> {
  const url = request.url;
  const signature = request.headers.get("x-twilio-signature");
  const bodyText = await request.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(bodyText)) {
    params[k] = v;
  }

  if (!validateTwilioSignature(url, signature, params)) {
    return new Response("forbidden", { status: 403 });
  }

  return twimlResponse(buildConsentWhisperTwiml());
}
