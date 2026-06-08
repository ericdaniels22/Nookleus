import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { validateTwilioSignature } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 9 (#313) — transcription-completed webhook.
//
// Twilio POSTs here when the <Record transcribe> auto-transcription finishes
// (the inbound-voice webhook wires this as the recording's transcribeCallback).
// The callback carries RecordingSid (matches twilio_recording_sid on
// phone_voicemails), TranscriptionText, and TranscriptionStatus
// ('completed' | 'failed'). We advance the voicemail row matched by
// RecordingSid: on success transcript = TranscriptionText and
// transcript_status = 'ready'; the failure path lands in slice 6.
//
// The UPDATE matches by twilio_recording_sid — an unknown SID matches zero
// rows and still 200s (silent drop, no Twilio retry storm). Unauthenticated;
// gated solely by X-Twilio-Signature. Service-client UPDATE — no auth user.

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

  const recordingSid = params.RecordingSid;
  if (!recordingSid) {
    return new Response("RecordingSid required", { status: 400 });
  }

  // On a failed transcription, persist the 'failed' status and DROP any
  // partial/garbage TranscriptionText Twilio may still include — transcript
  // stays null so the UI shows "transcript unavailable", not noise.
  const failed = params.TranscriptionStatus === "failed";
  const patch: Record<string, unknown> = failed
    ? { transcript: null, transcript_status: "failed" }
    : { transcript: params.TranscriptionText ?? null, transcript_status: "ready" };

  const supabase = createServiceClient();
  await supabase
    .from("phone_voicemails")
    .update(patch)
    .eq("twilio_recording_sid", recordingSid);

  return new Response("", { status: 200 });
}
