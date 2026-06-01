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
import {
  uploadPhoneAttachment,
  type PhoneStorageClient,
} from "@/lib/phone/attachments-storage";
import {
  validateMmsAttachment,
  type MmsMediaType,
} from "@/lib/phone/mms-attachments";
import { ingestInbound } from "@/lib/phone/ingest-inbound";

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

interface PersistedMmsAttachment {
  storage_path: string;
  media_type: string;
}

// Fetch each MediaUrlN out of the Twilio payload, copy the bytes to the
// `phone-attachments` bucket, and return what to persist on
// phone_messages.media_urls. Per-attachment failures are swallowed —
// losing the inbound message because one media fetch failed would be
// worse than a partial copy. Twilio retains its media for ~24h; a
// follow-up reconciliation could re-fetch the missing ones, but slice 6
// keeps the inbound write atomic.
async function copyTwilioMediaToBucket(
  client: PhoneStorageClient,
  params: Record<string, string>,
  orgId: string,
): Promise<PersistedMmsAttachment[]> {
  const numMedia = Number.parseInt(params.NumMedia ?? "0", 10);
  if (!Number.isFinite(numMedia) || numMedia <= 0) return [];

  const out: PersistedMmsAttachment[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`] ?? "";
    if (!url) continue;

    const validation = validateMmsAttachment({
      type: contentType,
      size: 0,
    });
    if (!validation.ok) continue;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const stored = await uploadPhoneAttachment(client, {
        orgId,
        mediaType: validation.mediaType as MmsMediaType,
        bytes,
      });
      out.push({
        storage_path: stored.storagePath,
        media_type: stored.mediaType,
      });
    } catch {
      // Best-effort: continue to the next attachment.
    }
  }
  return out;
}

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

  // 5. Slice 6 (#310) — MMS copy. If Twilio's payload carries media,
  //    fetch each URL and re-upload to the Nookleus bucket so the
  //    references on disk outlive Twilio's media retention.
  //    Per-attachment failures degrade gracefully (the message itself
  //    still persists with whatever copies succeeded).
  const mediaUrls = await copyTwilioMediaToBucket(
    supabase as unknown as PhoneStorageClient,
    params,
    decision.organizationId,
  );

  // 6. Slice 15 (#368) — Conversation upsert, inbound message insert,
  //    unread_count bump, STOP opt-out registry write, HELP auto-reply
  //    dispatch — all the shared inbound persistence — delegated to the
  //    `ingestInbound` helper. Same call site as the dev-mode
  //    `simulate-inbound` route, so the demo path cannot drift from real
  //    inbound behavior.
  await ingestInbound({
    supabase,
    decision,
    toE164,
    rawBody: params.Body ?? "",
    mediaUrls,
    twilioSid: params.MessageSid ?? null,
    smsStatus: params.SmsStatus ?? null,
  });

  return twimlResponse();
}
