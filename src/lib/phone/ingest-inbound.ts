// PRD #304 — Nookleus Phone. Slice 15 (#368) — ingestInbound helper.
//
// The conversation/message persistence shared by the real inbound SMS
// webhook AND the dev-mode `simulate-inbound` route. Extracted from the
// webhook so the demo path stays byte-for-byte faithful — the simulator
// cannot drift from real inbound behavior because it goes through the
// same helper.
//
// Order matters:
//   1. STOP-keyword opt-out upsert BEFORE message persist (the org-wide
//      TCPA gate cannot be bypassed by a half-failed insert).
//   2. Upsert the Conversation by (phone_number_id, outside_e164) — the
//      natural key from migration-308 (`phone_conversations_pair_unique`).
//   3. Insert the inbound phone_messages row with direction='in' and the
//      smart-attach job_tag (when the decision is 'auto').
//   4. Bump unread_count and last_event_at on the conversation row.
//   5. HELP auto-reply — when the body classifies as HELP/INFO AND the
//      outbound feature flag is on — dispatched via `sendSms` (which, in
//      demo mode, uses the fake provider). The auto-reply is logged as
//      its own outbound `phone_messages` row.
//
// The realtime subscription is INSERT-only and org-scoped, so the message
// inserts here automatically push to any open thread without extra wiring.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyOptOutKeyword } from "./opt-out-registry";
import { isPhoneOutboundEnabled } from "./feature-flags";
import { createTwilioClient, sendSms } from "./twilio-client";
import type { RouteInboundDecision } from "./route-inbound";

export interface IngestInboundMediaItem {
  storage_path: string;
  media_type: string;
}

export interface IngestInboundInput {
  // The Supabase client to write through. Real path: the Service client
  // (the webhook has no auth user). Simulator: the Service client too,
  // for the same reason — neither caller has an Active Organization JWT
  // tied to the org being written.
  supabase: SupabaseClient;
  decision: RouteInboundDecision;
  // The org's `phone_numbers.e164` the customer texted. Used as the
  // `from` on the HELP auto-reply and stored on the inbound message
  // row's `to_e164`.
  toE164: string;
  // The raw inbound body. Persisted as-is on the message row and fed
  // through the opt-out classifier.
  rawBody: string;
  // Already-persisted media references (the inbound webhook copies
  // Twilio's MediaUrlN into the bucket; the simulator can pass an empty
  // array or whatever shape the demo cares to surface).
  mediaUrls: IngestInboundMediaItem[];
  // Twilio's `MessageSid` (real webhook) — the simulator passes null.
  twilioSid: string | null;
  // Twilio's `SmsStatus` (real webhook) — the simulator passes null.
  smsStatus: string | null;
}

export async function ingestInbound(input: IngestInboundInput): Promise<void> {
  const { supabase, decision, toE164, rawBody, mediaUrls, twilioSid, smsStatus } =
    input;

  const optOutVerdict = classifyOptOutKeyword(rawBody);

  // 1. STOP — upsert opt-out FIRST so the gate is live the moment we
  //    persist the message. STOPALL / UNSUBSCRIBE / END / QUIT / CANCEL
  //    all classify as 'stop' via opt-out-registry.
  if (optOutVerdict === "stop") {
    await supabase
      .from("phone_opt_outs")
      .upsert(
        {
          organization_id: decision.organizationId,
          outside_e164: decision.outsideE164,
          opted_out_at: new Date().toISOString(),
          // STOP-after-re-opt-in clears the re_opted_in_at marker so the
          // outbound gate blocks again.
          re_opted_in_at: null,
          re_opted_in_note: null,
          re_opted_in_by_user_id: null,
        },
        { onConflict: "organization_id,outside_e164" },
      );
  }

  // 2. Upsert the Conversation.
  const now = new Date().toISOString();
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
    .select("id, unread_count")
    .single<{ id: string; unread_count: number }>();
  if (!conv) return;

  // 3. Insert the inbound message row.
  const jobTag =
    decision.smartAttach.kind === "auto" ? decision.smartAttach.jobId : null;
  await supabase.from("phone_messages").insert({
    organization_id: decision.organizationId,
    conversation_id: conv.id,
    direction: "in",
    from_e164: decision.outsideE164,
    to_e164: toE164,
    body: rawBody.length > 0 ? rawBody : null,
    media_urls: mediaUrls,
    twilio_sid: twilioSid,
    status: smsStatus,
    job_tag: jobTag,
    tagged_by_user_id: null,
    sent_by_user_id: null,
    sent_at: now,
  });

  // 4. Bump unread_count + last_event_at. The upsert above already set
  //    last_event_at; we update unread_count here because Supabase's
  //    PostgREST upsert path can't atomically increment an existing
  //    row's column.
  await supabase
    .from("phone_conversations")
    .update({ unread_count: (conv.unread_count ?? 0) + 1, last_event_at: now })
    .eq("id", conv.id);

  // 5. HELP — outbound auto-reply gated on the #309 outbound feature
  //    flag. The reply identifies the Organization and tells the customer
  //    how to opt out. In demo mode (#368) `sendSms` lands on the fake
  //    provider, so the auto-reply is observable in the thread without
  //    a carrier hop.
  if (optOutVerdict === "help" && isPhoneOutboundEnabled()) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", decision.organizationId)
      .maybeSingle<{ name: string }>();
    const orgName = orgRow?.name ?? "Nookleus";
    const helpReplyBody = `${orgName}: Reply STOP to unsubscribe. Standard message rates apply.`;
    try {
      const dispatch = await sendSms(createTwilioClient(), {
        from: toE164,
        to: decision.outsideE164,
        body: helpReplyBody,
      });
      const replyNow = new Date().toISOString();
      await supabase.from("phone_messages").insert({
        organization_id: decision.organizationId,
        conversation_id: conv.id,
        direction: "out",
        from_e164: toE164,
        to_e164: decision.outsideE164,
        body: helpReplyBody,
        media_urls: [],
        twilio_sid: dispatch.sid,
        status: dispatch.status,
        // Auto-replies are not tagged to a Job — they are system
        // messaging, not part of the Job's conversation.
        job_tag: null,
        tagged_by_user_id: null,
        sent_by_user_id: null,
        sent_at: replyNow,
      });
    } catch {
      // A failed HELP auto-reply is non-fatal; the carrier still
      // delivers Twilio's mandated HELP response. Swallowing the error
      // avoids retry-double-write through the Twilio webhook.
    }
  }
}
