import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  validateTwilioSignature,
  buildVoiceTwiml,
} from "@/lib/phone/twilio-client";
import { normalizePhoneToE164 } from "@/lib/phone";
import {
  routeInbound,
  type ContactForRoute,
  type PhoneNumberForRoute,
} from "@/lib/phone/route-inbound";
import type { ActiveJob } from "@/lib/phone/smart-attach";
import {
  decideShared,
  type InboundRule,
  type RoutableMember,
  type DecideSharedResult,
} from "@/lib/phone/route-shared-call";
import { ingestInboundCall } from "@/lib/phone/ingest-inbound-call";
import { signedUrlForVoicemailGreeting } from "@/lib/phone/voicemail-greeting-storage";

// PRD #304 — Nookleus Phone. Slice 8 (#312) — Inbound voice webhook.
//
// Twilio calls this URL when a customer dials one of our numbers. Like the
// inbound-SMS webhook it is unauthenticated and gated solely by the
// X-Twilio-Signature HMAC. All DB work uses the Service client — the
// webhook has no auth user, so RLS would refuse every read otherwise.
//
// Flow:
//   1. Validate the signature. 403 on invalid.
//   2. Look up the phone_numbers row by `To` to discover the org, the
//      number kind, and (for Shared) the inbound_rule. Unknown / released
//      number → empty <Response/> (Twilio hangs up).
//   3. Smart-attach + thread via the shared `routeInbound` (Body="" — a
//      voice call has no body and the tag decision is body-independent).
//   4. Decide the dial plan:
//        - Personal → always voicemail (ADR 0005: voicemail is a Personal
//          number's inbound rule always; the configurable rule is Shared-only).
//        - Shared → decideShared(inbound_rule, members, round-robin cursor).
//          `members` is the org roster with a cell on file (user_profiles.phone
//          normalized to E.164). Round-robin persists its advanced cursor to
//          phone_number_round_robin so the rotation survives restarts.
//   5. buildVoiceTwiml(decision, { callerId: <our number> }).
//   6. ingestInboundCall writes a ringing phone_calls row threaded on the
//      same conversation as the slice-4 messages.
//   7. 200 with the TwiML.

const ACTIVE_STATUSES = ["new", "in_progress", "pending_invoice"] as const;

// Empty TwiML — Twilio executes it as "hang up". Used for a call to a
// number that is not (or no longer) ours.
const HANGUP_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

// The phone_numbers slice the voice route needs: the routing fields plus
// the Shared-only inbound_rule jsonb and the optional custom-greeting path.
interface PhoneNumberForVoiceRoute extends PhoneNumberForRoute {
  inbound_rule: InboundRule | null;
  voicemail_greeting_url: string | null;
}

// Slice 13 (#317) — a voicemail greeting plays within seconds of the call
// reaching the voicemail branch; a generous TTL only guards Twilio retries and
// clock skew. The bucket is private, so the URL is signed fresh on every call
// and never persisted.
const VOICEMAIL_GREETING_SIGNED_URL_TTL_SECONDS = 3600;

// A user_organizations row with the embedded profile cell. Supabase returns
// the to-one embed as an object (older shapes returned a single-element
// array); we normalize both.
interface MemberRow {
  user_id: string;
  user_profiles: { phone: string | null } | { phone: string | null }[] | null;
}

function twimlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function profilePhone(row: MemberRow): string | null {
  const p = Array.isArray(row.user_profiles)
    ? row.user_profiles[0]
    : row.user_profiles;
  return p?.phone ?? null;
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

  const fromE164 = normalizePhoneToE164(params.From ?? "");
  const toE164 = normalizePhoneToE164(params.To ?? "");
  if (!fromE164 || !toE164) {
    return twimlResponse(HANGUP_TWIML);
  }

  const supabase = createServiceClient();

  // 1. Resolve the number (org + kind + inbound_rule) from the To address.
  const { data: numberRow } = await supabase
    .from("phone_numbers")
    .select(
      "id, organization_id, e164, kind, user_id, released_at, inbound_rule, voicemail_greeting_url",
    )
    .eq("e164", toE164)
    .maybeSingle<PhoneNumberForVoiceRoute>();

  if (!numberRow || numberRow.released_at) {
    return twimlResponse(HANGUP_TWIML);
  }

  // 2. Load the org's jobs + contacts so routeInbound can smart-attach and
  //    thread. Mirrors the inbound-SMS webhook.
  const { data: jobRows } = await supabase
    .from("jobs")
    .select("id, contact_id, status, job_number")
    .eq("organization_id", numberRow.organization_id);
  const jobsList = (jobRows ?? []) as Array<{
    id: string;
    contact_id: string;
    status: string;
    job_number: string;
  }>;

  const contactIds = Array.from(new Set(jobsList.map((j) => j.contact_id)));
  let contacts: ContactForRoute[] = [];
  if (contactIds.length > 0) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("id, phone")
      .in("id", contactIds);
    contacts = (contactRows ?? []) as ContactForRoute[];
  }

  const activeJobsByContact: Record<string, ActiveJob[]> = {};
  for (const j of jobsList) {
    if (!ACTIVE_STATUSES.includes(j.status as (typeof ACTIVE_STATUSES)[number])) {
      continue;
    }
    (activeJobsByContact[j.contact_id] ??= []).push({
      id: j.id,
      label: j.job_number,
    });
  }

  const decision = routeInbound({
    payload: { From: fromE164, To: toE164, Body: "" },
    orgNumbers: [numberRow],
    contacts,
    activeJobsByContact,
  });
  if (!decision) return twimlResponse(HANGUP_TWIML);

  // 3. Decide the dial plan.
  let result: DecideSharedResult;
  if (numberRow.kind === "personal") {
    // A Personal number's inbound rule is always voicemail (ADR 0005).
    result = { kind: "voicemail" };
  } else {
    const config = (numberRow.inbound_rule ?? null) as InboundRule | null;

    const { data: memberRows } = await supabase
      .from("user_organizations")
      .select("user_id, user_profiles:user_id(phone)")
      .eq("organization_id", numberRow.organization_id);
    const members: RoutableMember[] = ((memberRows ?? []) as MemberRow[]).map(
      (r) => {
        const raw = profilePhone(r);
        return {
          userId: r.user_id,
          cellE164: raw ? normalizePhoneToE164(raw) : null,
        };
      },
    );

    const { data: rrRow } = await supabase
      .from("phone_number_round_robin")
      .select("rotation_cursor")
      .eq("phone_number_id", numberRow.id)
      .maybeSingle<{ rotation_cursor: number }>();
    const cursor = rrRow?.rotation_cursor ?? 0;

    result = decideShared({ config, members, roundRobinCursor: cursor });

    // Persist the advanced rotation cursor so the next call picks the next
    // member. Monotonic — decideShared mods by the reachable count.
    if (result.kind === "round-robin") {
      await supabase.from("phone_number_round_robin").upsert(
        {
          phone_number_id: numberRow.id,
          organization_id: numberRow.organization_id,
          rotation_cursor: result.nextCursor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id" },
      );
    }
  }

  // Slice 11 (#315) — does this Organization record calls by default? The
  // column is NOT NULL default true, so a real org always carries a value; a
  // missing row falls back to "don't record" (fail-safe for consent). When on,
  // buildVoiceTwiml speaks the consent notice on the answered (dial) branches,
  // records the bridge dual-channel, and whispers consent to each answering
  // cell. Recording is orthogonal to the voicemail branch (which the builder
  // leaves unchanged). Per-number / per-call inbound overrides are out of scope
  // for this slice (issue #315).
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("recording_enabled_default")
    .eq("id", numberRow.organization_id)
    .maybeSingle<{ recording_enabled_default: boolean }>();
  const recordCall = orgRow?.recording_enabled_default ?? false;

  // Slice 13 (#317) — custom voicemail greeting. When the call routes to
  // voicemail and the number carries a recorded greeting, sign its private
  // storage object so the builder <Play>s it instead of <Say>ing the default
  // text. Signed fresh per call (the bucket is private); a signing failure
  // falls back to the default greeting rather than dropping the call.
  let voicemailGreetingUrl: string | undefined;
  if (result.kind === "voicemail" && numberRow.voicemail_greeting_url) {
    try {
      voicemailGreetingUrl = await signedUrlForVoicemailGreeting(
        supabase,
        numberRow.voicemail_greeting_url,
        VOICEMAIL_GREETING_SIGNED_URL_TTL_SECONDS,
      );
    } catch {
      voicemailGreetingUrl = undefined;
    }
  }

  // Slice 9 (#313) — voicemail callback URLs. Passed on every call (the
  // builder ignores them in the dial branches); the <Record> verb in the
  // voicemail branch posts the finished recording to voicemail-completed and
  // the auto-transcription to transcription-completed. Fully-qualified URLs
  // from env, mirroring PHONE_STATUS_CALLBACK_URL for outbound SMS.
  const twiml = buildVoiceTwiml(result, {
    callerId: toE164,
    voicemailGreetingUrl,
    recordingStatusCallback: process.env.PHONE_VOICEMAIL_CALLBACK_URL || undefined,
    transcribeCallback: process.env.PHONE_TRANSCRIPTION_CALLBACK_URL || undefined,
    // Slice 11 (#315) — answered-call recording + consent (no-op in the
    // voicemail branch). callRecordingStatusCallback → recording-completed
    // webhook; consentWhisperUrl → the per-leg consent whisper.
    recordCall,
    callRecordingStatusCallback:
      process.env.PHONE_RECORDING_CALLBACK_URL || undefined,
    consentWhisperUrl: process.env.PHONE_RECORDING_WHISPER_URL || undefined,
  });

  // 4. Persist the ringing call row, threaded on the conversation.
  await ingestInboundCall({
    supabase,
    decision,
    toE164,
    twilioCallSid: params.CallSid ?? null,
    status: "ringing",
  });

  return twimlResponse(twiml);
}
