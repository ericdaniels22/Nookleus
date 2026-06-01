// PRD #304 — Nookleus Phone. Slice 15 (#368) — dev-mode inbound simulator.
//
// POST /api/phone/dev/simulate-inbound — body { from, to, body, mediaUrls? }.
//
// Hard-404 unless `NOOKLEUS_PHONE_DEMO_MODE === 'true'`: the route surface
// must not exist in production. (The `createTwilioClient` factory itself
// throws under NODE_ENV='production' when the demo flag is set, so even a
// production server-process mistakenly handed this URL would refuse before
// ever touching the customer.)
//
// When demo mode is on the route:
//   1. Resolves the org Shared/Personal number from `to` via phone_numbers.
//   2. Loads the org's Contacts and Active jobs (real DB reads, same shape
//      as the real inbound webhook).
//   3. Calls the pure `routeInbound()` for the routing decision.
//   4. Delegates to `ingestInbound()` — the same shared helper the real
//      inbound webhook calls — so the demo path cannot drift from real
//      inbound behavior: STOP opt-out persistence, smart-attach Job
//      tagging, Conversation threading, unread_count bump, HELP auto-reply
//      (the auto-reply goes through `sendSms`, which uses the fake
//      provider in demo mode).
//
// The route does NOT validate a Twilio signature (it isn't a Twilio
// webhook). The existing realtime INSERT-listener pushes the new message
// into the open thread live — no special realtime wiring needed.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { normalizePhoneToE164 } from "@/lib/phone";
import {
  routeInbound,
  type ContactForRoute,
  type PhoneNumberForRoute,
} from "@/lib/phone/route-inbound";
import type { ActiveJob } from "@/lib/phone/smart-attach";
import { ingestInbound, type IngestInboundMediaItem } from "@/lib/phone/ingest-inbound";

const ACTIVE_STATUSES = ["new", "in_progress", "pending_invoice"] as const;

interface SimulateInboundBody {
  from?: unknown;
  to?: unknown;
  body?: unknown;
  mediaUrls?: unknown;
}

function parseMediaUrls(input: unknown): IngestInboundMediaItem[] {
  if (!Array.isArray(input)) return [];
  const out: IngestInboundMediaItem[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const storage_path = obj.storage_path;
    const media_type = obj.media_type;
    if (typeof storage_path === "string" && typeof media_type === "string") {
      out.push({ storage_path, media_type });
    }
  }
  return out;
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

export async function POST(request: NextRequest | Request): Promise<Response> {
  // Demo-mode gate — must come first, before any DB or body work, so the
  // route surface is completely invisible when the flag is off.
  if (process.env.NOOKLEUS_PHONE_DEMO_MODE !== "true") {
    return notFound();
  }

  const payload = (await request.json().catch(() => null)) as SimulateInboundBody | null;
  if (!payload) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const rawFrom = typeof payload.from === "string" ? payload.from : "";
  const rawTo = typeof payload.to === "string" ? payload.to : "";
  const rawBody = typeof payload.body === "string" ? payload.body : "";
  const fromE164 = normalizePhoneToE164(rawFrom);
  const toE164 = normalizePhoneToE164(rawTo);
  if (!fromE164) {
    return NextResponse.json(
      { error: "from is required and must be a valid US phone number" },
      { status: 400 },
    );
  }
  if (!toE164) {
    return NextResponse.json(
      { error: "to is required and must be a valid US phone number" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // 1. Resolve the org from the `to` address.
  const { data: numberRow } = await supabase
    .from("phone_numbers")
    .select("id, organization_id, e164, kind, user_id, released_at")
    .eq("e164", toE164)
    .maybeSingle<PhoneNumberForRoute>();

  if (!numberRow || numberRow.released_at) {
    return notFound();
  }

  // 2. Load the org's contacts via the jobs join (same approach as the
  //    real webhook — `contacts` are surfaced through org-scoped jobs).
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

  // 3. Group Active jobs by contact — Active = status NOT IN
  //    ('completed', 'cancelled'); see schema.sql jobs.status CHECK.
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
    payload: { From: fromE164, To: toE164, Body: rawBody },
    orgNumbers: [numberRow],
    contacts,
    activeJobsByContact,
  });
  if (!decision) {
    return notFound();
  }

  // 5. Delegate to the shared ingestInbound helper — same path as the
  //    real inbound webhook.
  await ingestInbound({
    supabase,
    decision,
    toE164,
    rawBody,
    mediaUrls: parseMediaUrls(payload.mediaUrls),
    twilioSid: null,
    smsStatus: null,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
