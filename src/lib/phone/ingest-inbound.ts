// PRD #368 — Phone demo/dev mode. Slice 15b (#371).
//
// The persistence half of the inbound-SMS pipeline. The webhook route
// (`/api/phone/webhook/sms-inbound`) owns I/O at the edge — signature
// validation, form parsing, org/number resolution, contacts +
// active-jobs loads, the MMS `MediaUrlN` copy — and then hands a fully
// resolved `RouteInboundDecision` (from the pure `routeInbound()`),
// the raw inbound fields, and the already-copied `media_urls` array
// into this helper, which performs every DB write:
//
//   1. STOP keyword → upsert `phone_opt_outs` by
//      (organization_id, outside_e164) BEFORE any message persist
//      (defense-in-depth: the registry must land even if the message
//      insert later fails).
//   2. Upsert `phone_conversations` by (phone_number_id, outside_e164).
//   3. Insert the inbound `phone_messages` row (direction='in',
//      smart-attach `job_tag`).
//   4. Bump `unread_count` + `last_event_at` on the conversation.
//   5. HELP keyword (and `isPhoneOutboundEnabled()`) → dispatch the
//      standard auto-reply via `sendSms(createTwilioClient(), ...)`
//      and log it as an outbound `phone_messages` row.
//
// The helper is provider-agnostic — `sendSms` accepts any
// `TwilioClientLike`, so the demo simulator (15c) can replace the
// real client with a fake without touching this module.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyOptOutKeyword } from "./opt-out-registry";
import { isPhoneOutboundEnabled } from "./feature-flags";
import { createTwilioClient, sendSms } from "./twilio-client";
import type { RouteInboundDecision } from "./route-inbound";

export interface InboundMediaUrl {
  storage_path: string;
  media_type: string;
}

export interface IngestInboundInput {
  decision: RouteInboundDecision;
  // The inbound `To` (one of our `phone_numbers` rows), normalized to
  // E.164 by the webhook. Used as `to_e164` on the message row and as
  // `from` on the HELP auto-reply.
  toE164: string;
  // The raw Twilio `Body`. Null when the payload omitted it; empty
  // string is allowed and surfaces as-is on the row (Twilio sends ""
  // for MMS-only messages).
  body: string | null;
  // The Twilio `MessageSid` of the inbound. Null if the webhook payload
  // omitted it (defensive — Twilio always supplies it in practice).
  messageSid: string | null;
  // The Twilio `SmsStatus` (typically "received"). Null when absent.
  smsStatus: string | null;
  // The MMS attachments already copied into the `phone-attachments`
  // bucket by the webhook. Empty array for plain SMS.
  mediaUrls: InboundMediaUrl[];
  // The org's display name, used to identify the org in the HELP
  // auto-reply body. The webhook resolves this from `organizations`.
  orgName: string;
}

// The helper takes the same Supabase service client the webhook
// constructs via `createServiceClient()`. Typed as the generic
// `SupabaseClient` so the helper stays decoupled from the database
// schema — call sites and tests can pass any structurally-compatible
// fake, with a cast at the boundary if the fake omits Supabase's
// auth/storage surfaces.
export async function ingestInbound(
  supabase: SupabaseClient,
  input: IngestInboundInput,
): Promise<void> {
  const { decision, toE164, body, messageSid, smsStatus, mediaUrls, orgName } =
    input;
  const optOutVerdict = classifyOptOutKeyword(body ?? "");

  // 1. STOP must land BEFORE the message persist — defense-in-depth so
  //    the opt-out gate cannot be bypassed by a downstream write failure.
  if (optOutVerdict === "stop") {
    await supabase.from("phone_opt_outs").upsert(
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

  // 2. Conversation upsert by the natural key.
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

  // 3. Inbound message insert with the smart-attach job_tag.
  const jobTag =
    decision.smartAttach.kind === "auto" ? decision.smartAttach.jobId : null;
  await supabase.from("phone_messages").insert({
    organization_id: decision.organizationId,
    conversation_id: conv.id,
    direction: "in",
    from_e164: decision.outsideE164,
    to_e164: toE164,
    body,
    media_urls: mediaUrls,
    twilio_sid: messageSid,
    status: smsStatus,
    job_tag: jobTag,
    tagged_by_user_id: null,
    sent_by_user_id: null,
    sent_at: now,
  });

  // 4. Bump unread + last_event_at. PostgREST's upsert path can't
  //    atomically increment an existing row's column, so we follow up
  //    with an UPDATE that reads `unread_count` from the upsert reply.
  await supabase
    .from("phone_conversations")
    .update({ unread_count: (conv.unread_count ?? 0) + 1, last_event_at: now })
    .eq("id", conv.id);

  // 5. HELP auto-reply. Gated on the #309 feature flag so that until
  //    A2P clears we don't dispatch outbound — Twilio's carrier-side
  //    auto-reply still reaches the customer.
  if (optOutVerdict === "help" && isPhoneOutboundEnabled()) {
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
        // Auto-replies are system messaging, not part of any Job thread.
        job_tag: null,
        tagged_by_user_id: null,
        sent_by_user_id: null,
        sent_at: replyNow,
      });
    } catch {
      // A failed HELP-auto-reply is non-fatal; the customer still
      // receives Twilio's carrier-mandated HELP response. Swallow the
      // error rather than propagating — the inbound row already landed.
    }
  }
}
