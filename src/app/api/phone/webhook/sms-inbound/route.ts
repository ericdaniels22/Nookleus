import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { validateTwilioSignature } from "@/lib/phone/twilio-client";
import { normalizePhoneToE164 } from "@/lib/phone";
import {
  routeInbound,
  type ContactForRoute,
  type PhoneNumberForRoute,
} from "@/lib/phone/route-inbound";
import type { ActiveJob } from "@/lib/phone/smart-attach";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — Inbound SMS webhook.
//
// Twilio calls this URL when an inbound SMS hits one of our numbers. The
// route is unauthenticated (Twilio is not a logged-in user); it gates by
// the X-Twilio-Signature HMAC instead.
//
// Flow:
//   1. Read the form-encoded body (Twilio sends application/x-www-form-urlencoded).
//   2. Validate the signature against the (URL, params) pair using
//      `validateTwilioSignature`. Reject 403 on invalid.
//   3. Look up the `phone_numbers` row whose e164 matches `To` to discover
//      the org. If no match, return 200 with empty TwiML (a Twilio webhook
//      always returns 200 unless we want to retry — silent drop is the
//      right behavior for a stale or wrong-org webhook URL).
//   4. Pull the org's contacts + Active jobs. Pass everything to
//      `routeInbound` (pure) for the smart-attach decision.
//   5. Upsert the `phone_conversations` row (by phone_number_id +
//      outside_e164 — the natural key), insert the `phone_messages` row,
//      bump `last_event_at` and `unread_count`.
//   6. Return 200 with an empty TwiML `<Response/>`.
//
// All DB work uses the Service client — the webhook has no auth user, so
// RLS would refuse every read otherwise.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

const ACTIVE_STATUSES = ["new", "in_progress", "pending_invoice"] as const;

function twimlResponse(status = 200): Response {
  return new Response(EMPTY_TWIML, {
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

  const fromE164 = normalizePhoneToE164(params.From ?? "");
  const toE164 = normalizePhoneToE164(params.To ?? "");
  if (!fromE164 || !toE164) {
    return twimlResponse();
  }

  const supabase = createServiceClient();

  // 1. Resolve the org from the To address.
  const { data: numberRow } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, e164, kind, user_id, released_at")
    .eq("e164", toE164)
    .maybeSingle<PhoneNumberForRoute>();

  if (!numberRow || numberRow.released_at) {
    return twimlResponse();
  }

  // 2. Load the org's contacts (slice 4: every contact in the org —
  //    `contacts` has no organization_id surfaced via FK; the schema
  //    relies on jobs → contacts and org scoping through jobs. We use
  //    contacts referenced by org's jobs as the candidate pool).
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

  // 3. Group Active jobs by contact. Active = status NOT IN
  //    ('completed', 'cancelled') — see schema.sql jobs.status CHECK.
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

  // 4. Pure routing decision.
  const decision = routeInbound({
    payload: { From: fromE164, To: toE164, Body: params.Body ?? "" },
    orgNumbers: [numberRow],
    contacts,
    activeJobsByContact,
  });
  if (!decision) return twimlResponse();

  // 5. Upsert the conversation. ON CONFLICT on (phone_number_id,
  //    outside_e164) — see migration-308 `phone_conversations_pair_unique`.
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
  if (!conv) return twimlResponse();

  // 6. Insert the message.
  const jobTag =
    decision.smartAttach.kind === "auto" ? decision.smartAttach.jobId : null;
  await supabase.from("phone_messages").insert({
    organization_id: decision.organizationId,
    conversation_id: conv.id,
    direction: "in",
    from_e164: decision.outsideE164,
    to_e164: toE164,
    body: params.Body ?? null,
    media_urls: [],
    twilio_sid: params.MessageSid ?? null,
    status: params.SmsStatus ?? null,
    job_tag: jobTag,
    tagged_by_user_id: null,
    sent_by_user_id: null,
    sent_at: now,
  });

  // 7. Bump the unread count + last_event_at on the conversation. The
  //    upsert above already set last_event_at; we update unread_count
  //    here because Supabase's PostgREST upsert path can't atomically
  //    increment an existing row's column.
  await supabase
    .from("phone_conversations")
    .update({ unread_count: (conv.unread_count ?? 0) + 1, last_event_at: now })
    .eq("id", conv.id);

  return twimlResponse();
}
