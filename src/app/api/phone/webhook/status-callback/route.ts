import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { validateTwilioSignature } from "@/lib/phone/twilio-client";

// PRD #304 — Nookleus Phone. Slice 5 (#309) — outbound delivery
// status callback.
//
// Twilio POSTs here for every outbound message we sent with a
// `statusCallback` URL. Twilio's status state machine:
//   queued → sending → sent → delivered    (happy path)
//                            → undelivered  (carrier rejected)
//                            → failed       (Twilio rejected)
//
// The route looks up the local row by `twilio_sid` and updates its
// `status` column. The thread UI then reflects the new state on the next
// realtime tick (or refresh) — slice 4's realtime subscription is on
// INSERTs only; status updates show up via re-fetch when the user opens
// the thread, and a future slice can extend the subscription to UPDATEs.
//
// Unauthenticated; gated solely by X-Twilio-Signature. Service-client
// UPDATE — no auth user, so RLS would otherwise refuse.

const EMPTY_OK = new Response("", { status: 200 });

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

  const sid = params.MessageSid;
  const status = params.MessageStatus;
  if (!sid) {
    return new Response("MessageSid required", { status: 400 });
  }

  const supabase = createServiceClient();
  await supabase
    .from("phone_messages")
    .update({ status: status ?? null })
    .eq("twilio_sid", sid);

  return EMPTY_OK;
}
