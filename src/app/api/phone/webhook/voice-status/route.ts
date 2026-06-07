import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { validateTwilioSignature } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 8 (#312) — inbound voice status callback.
//
// Twilio POSTs here on every CallStatus transition for a call we routed
// (the inbound-voice webhook sets this URL as the call's statusCallback).
// The callback carries CallSid, CallStatus, and — once the call ends —
// CallDuration. We advance the matching phone_calls row by CallSid.
//
// Twilio's voice CallStatus vocabulary uses hyphens ('in-progress',
// 'no-answer'); our status CHECK uses underscores ('in_progress',
// 'no_answer'). A `-` → `_` replace maps the whole vocabulary; the
// hyphen-free values ('completed', 'busy', 'failed', 'canceled', 'queued',
// 'ringing') pass through unchanged.
//
// Unauthenticated; gated solely by X-Twilio-Signature. Service-client
// UPDATE under the hood — no auth user is present.

// The call has ended on these statuses — stamp ended_at.
const TERMINAL_STATUSES = new Set([
  "completed",
  "busy",
  "failed",
  "no_answer",
  "canceled",
]);

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

  const sid = params.CallSid;
  if (!sid) {
    return new Response("CallSid required", { status: 400 });
  }

  const status = params.CallStatus
    ? params.CallStatus.replace(/-/g, "_")
    : null;

  const patch: Record<string, unknown> = { status };

  // CallDuration is present once the call has ended.
  const durationRaw = params.CallDuration;
  if (durationRaw !== undefined && durationRaw !== "") {
    const seconds = Number.parseInt(durationRaw, 10);
    if (Number.isFinite(seconds)) {
      patch.duration_seconds = seconds;
    }
  }

  if (status && TERMINAL_STATUSES.has(status)) {
    patch.ended_at = new Date().toISOString();
  }

  const supabase = createServiceClient();
  await supabase.from("phone_calls").update(patch).eq("twilio_call_sid", sid);

  return new Response("", { status: 200 });
}
