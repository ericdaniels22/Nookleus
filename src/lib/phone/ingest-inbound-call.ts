// PRD #304 — Nookleus Phone. Slice 8 (#312) — ingestInboundCall helper.
//
// The conversation-threading + call-row persistence the inbound VOICE
// webhook performs, mirroring `ingestInbound` (the SMS helper). A voice
// call threads on the SAME phone_conversations row as the slice-4 messages
// (natural key: phone_number_id + outside_e164), so a call and a text to
// the same outside number interleave in one Phone-tab thread.
//
//   1. Upsert the Conversation by (phone_number_id, outside_e164) — sets
//      last_event_at so the thread sorts to the top.
//   2. Insert a phone_calls row (direction='in', status='ringing' at
//      dial-start) carrying the smart-attach job_tag when the decision is
//      'auto'. The status-callback webhook later advances status +
//      duration_seconds + ended_at.
//
// Unlike ingestInbound, a call does NOT bump unread_count — a 'ringing'
// insert happens before we know whether the call was answered.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteInboundDecision } from "./route-inbound";

export interface IngestInboundCallInput {
  // The Service client (the webhook has no auth user, so RLS would refuse).
  supabase: SupabaseClient;
  decision: RouteInboundDecision;
  // The org's `phone_numbers.e164` the customer dialed — stored as the
  // call row's to_e164.
  toE164: string;
  // Twilio's CallSid; the status-callback webhook keys on this to advance
  // the row's status as the call progresses.
  twilioCallSid: string | null;
  // The status to write at dial-start — 'ringing'.
  status: string;
}

export async function ingestInboundCall(
  input: IngestInboundCallInput,
): Promise<void> {
  const { supabase, decision, toE164, twilioCallSid, status } = input;

  const now = new Date().toISOString();

  // 1. Upsert the Conversation (same natural key as the SMS path).
  const { data: conv } = await supabase
    .from("phone_conversations")
    .upsert(
      {
        organization_id: decision.organizationId,
        phone_number_id: decision.phoneNumberId,
        outside_e164: decision.outsideE164,
        contact_id: decision.contactId,
        last_event_at: now,
      },
      { onConflict: "phone_number_id,outside_e164" },
    )
    .select("id")
    .single<{ id: string }>();
  if (!conv) return;

  // 2. Insert the inbound call row.
  const jobTag =
    decision.smartAttach.kind === "auto" ? decision.smartAttach.jobId : null;
  await supabase.from("phone_calls").insert({
    organization_id: decision.organizationId,
    conversation_id: conv.id,
    direction: "in",
    from_e164: decision.outsideE164,
    to_e164: toE164,
    twilio_call_sid: twilioCallSid,
    status,
    duration_seconds: null,
    job_tag: jobTag,
    tagged_by_user_id: null,
    initiated_by_user_id: null,
    started_at: now,
  });
}
