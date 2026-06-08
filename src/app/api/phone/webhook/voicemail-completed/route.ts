import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { validateTwilioSignature } from "@/lib/phone/twilio-client";
import { uploadPhoneRecording } from "@/lib/phone/recordings-storage";

// PRD #304 — Nookleus Phone. Slice 9 (#313) — voicemail-completed webhook.
//
// Twilio POSTs here when an inbound call's <Record> verb finishes (the
// inbound-voice webhook wires this as the recording's recordingStatusCallback).
// The callback carries CallSid (the parent call), RecordingSid / RecordingUrl
// (Twilio's handle + media URL), and RecordingDuration. We look up the parent
// phone_calls row by CallSid to inherit its org + id, then insert a
// phone_voicemails row at transcript_status 'pending'. The transcript fills in
// later via the transcription-completed webhook; the audio is copied into the
// phone-recordings bucket in a later step.
//
// Unauthenticated; gated solely by X-Twilio-Signature. Service-client writes —
// the webhook has no auth user, so RLS would otherwise refuse the insert.

// Fetch the recording's MP3 from Twilio. Twilio serves the WAV at the bare
// RecordingUrl and an MP3 at the `.mp3` suffix; we store the smaller,
// browser-playable MP3. Authenticated with the account credentials in case
// the recording is access-protected.
async function fetchRecordingMp3(recordingUrl: string): Promise<Uint8Array> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const headers: Record<string, string> = {};
  if (accountSid && authToken) {
    headers.Authorization =
      "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  }
  const res = await fetch(`${recordingUrl}.mp3`, { headers });
  if (!res.ok) {
    throw new Error(`twilio recording fetch failed: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
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

  const callSid = params.CallSid;
  if (!callSid) {
    return new Response("CallSid required", { status: 400 });
  }

  const supabase = createServiceClient();

  // Look up the parent call to inherit its org + id. Unknown CallSid → 200
  // silent drop so Twilio stops retrying (the call may predate this feature
  // or have been deleted).
  const { data: call } = await supabase
    .from("phone_calls")
    .select("id, organization_id")
    .eq("twilio_call_sid", callSid)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!call) {
    return new Response("", { status: 200 });
  }

  const durationRaw = params.RecordingDuration;
  let duration_seconds: number | null = null;
  if (durationRaw !== undefined && durationRaw !== "") {
    const seconds = Number.parseInt(durationRaw, 10);
    if (Number.isFinite(seconds)) duration_seconds = seconds;
  }

  // Upsert on the phone_call_id unique key: a Twilio retry of the same
  // recordingStatusCallback must conflict-drop, not raise a unique violation
  // (which would 500 and trigger further Twilio retries).
  await supabase.from("phone_voicemails").upsert(
    {
      organization_id: call.organization_id,
      phone_call_id: call.id,
      twilio_recording_sid: params.RecordingSid ?? null,
      twilio_recording_url: params.RecordingUrl ?? null,
      duration_seconds,
      transcript_status: "pending",
    },
    { onConflict: "phone_call_id", ignoreDuplicates: true },
  );

  // A Twilio retry of the same recordingStatusCallback conflict-drops the
  // upsert above (ignoreDuplicates). If the FIRST delivery already copied the
  // audio, the copy below must NOT run again: uploadPhoneRecording mints a
  // fresh UUID per call (upsert:false), so a re-copy would orphan the original
  // object in the bucket and clobber the stored path. A copy that previously
  // FAILED left audio_storage_path null, so a retry still gets to finish it.
  // (Narrow residual: two callbacks racing before either copies will each
  // upload once — Twilio spaces its retries, so this isn't observed.)
  const { data: existing } = await supabase
    .from("phone_voicemails")
    .select("audio_storage_path")
    .eq("phone_call_id", call.id)
    .maybeSingle<{ audio_storage_path: string | null }>();

  if (existing?.audio_storage_path) {
    return new Response("", { status: 200 });
  }

  // Copy the audio out of Twilio into the org-scoped phone-recordings bucket so
  // playback outlives Twilio's media retention and deletion is under our
  // control (PRD #304 story 54). A copy failure is SWALLOWED: the voicemail row
  // already persists at 'pending', so we 200 (no Twilio retry storm) and leave
  // audio_storage_path null — a later Twilio redelivery retries the copy.
  const recordingUrl = params.RecordingUrl;
  if (recordingUrl) {
    try {
      const bytes = await fetchRecordingMp3(recordingUrl);
      const { storagePath } = await uploadPhoneRecording(supabase, {
        orgId: call.organization_id,
        bytes,
      });
      await supabase
        .from("phone_voicemails")
        .update({ audio_storage_path: storagePath })
        .eq("phone_call_id", call.id);
    } catch (err) {
      console.error("voicemail-completed: audio copy failed", err);
    }
  }

  return new Response("", { status: 200 });
}
