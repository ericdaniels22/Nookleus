import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  buildBridgeTwiml,
  createTwilioClient,
  placeBridgeCall,
} from "@/lib/phone/twilio-client";
import { normalizePhoneToE164 } from "@/lib/phone";
import {
  selectOutboundNumber,
  type SelectableNumber,
} from "@/lib/phone/select-outbound-number";
import {
  decideJobTag,
  type ActiveJob,
  type SmartAttachSource,
} from "@/lib/phone/smart-attach";

// PRD #304 — Nookleus Phone. Slice 10 (#314) — outbound bridge call.
//
// A Crew Lead clicks Call. Twilio rings THEIR OWN cell (the number on
// `user_profiles.phone`); on answer Twilio executes the inline bridge TwiML
// — `<Dial callerId="<Nookleus number>"><Number><customer></Number></Dial>`
// — so the customer's phone shows the Nookleus number, never the crew
// lead's real cell. The bridge is the caller-ID-spoofing safety: the cell
// is a routing detail that never leaves this server and never lands on the
// `phone_calls` row.
//
// Unlike the SMS route there is NO A2P 10DLC feature-flag gate — voice
// carries no 10DLC dependency, so the route is live wherever view_phone is
// granted. The gates, in order (cheapest refusal first, Twilio last):
//   1. view_phone (the wrapper) — admins pass by role.
//   2. Resolve the customer E.164 (existing conversation or first contact).
//   3. Outbound-number rule — refuse if the org owns no active number to
//      present as caller ID (owned-number safety; 422).
//   4. Profile-cell gate — refuse if the caller has no cell to ring (422).
//   5. TCPA opt-out — refuse before any Twilio call (403).
//   6. Job-ownership gate — if a `{ kind:'job' }` source is given, refuse
//      unless the Job exists and belongs to the caller's org (#531; 422),
//      before Twilio and before any DB write.
//   7. Twilio dispatch BEFORE the DB write — we never want a phone_calls
//      row claiming a dispatch that didn't happen (502 on Twilio error).
//   8. Insert the phone_calls row (direction='out', initiated_by_user_id).
//
// The Twilio call lifecycle is tracked by the existing voice-status webhook
// keyed on CallSid — generic over inbound/outbound, so the outbound row is
// advanced through the state machine with no new webhook.

interface Body {
  conversationId?: unknown;
  outsideE164?: unknown;
  // Valid sources: 'phone-tab' / 'contact' / 'contact-card' (untagged) and
  // `{ kind: 'job', jobId }` (Job-page Call, auto-tagged to that Job).
  sourceContext?: unknown;
  // Slice 11 (#315) — per-call recording override. Omitted → the org's
  // recording_enabled_default. Explicit `false` suppresses both the consent
  // notice and the recording for THIS call (the override the issue specifies).
  recordCall?: unknown;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

// Slice 12 (#316) — Job-page Calls section. The same call shape the Phone-tab
// thread route (conversations/[id]/calls) returns: every field the row carries
// plus its voicemail + recording embeds, each flattened from PostgREST's 0-or-1
// array (UNIQUE per call) to a single `voicemail | null` / `recording | null`.
const JOB_CALL_FIELDS =
  "id, organization_id, conversation_id, direction, from_e164, to_e164, twilio_call_sid, status, duration_seconds, job_tag, tagged_by_user_id, initiated_by_user_id, started_at, ended_at, created_at, phone_voicemails(id, audio_storage_path, transcript, transcript_status, duration_seconds), phone_recordings(id, audio_storage_path, consent_notice_played, duration_seconds)";

function flattenChild(
  row: Record<string, unknown>,
  embedKey: string,
  field: string,
): Record<string, unknown> {
  const { [embedKey]: embed, ...rest } = row;
  const value = Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
  return { ...rest, [field]: value };
}

function parseSourceContext(input: unknown): SmartAttachSource {
  if (typeof input === "string") {
    if (input === "phone-tab") return { kind: "phone-tab" };
    if (input === "contact" || input === "contact-card") {
      return { kind: "contact-card" };
    }
    if (input === "inbound") return { kind: "inbound" };
    return { kind: "phone-tab" };
  }
  if (input && typeof input === "object" && "kind" in input) {
    const kind = (input as { kind?: unknown }).kind;
    if (kind === "phone-tab" || kind === "contact-card" || kind === "inbound") {
      return { kind };
    }
    if (kind === "contact") return { kind: "contact-card" };
    if (kind === "job") {
      const jobId = (input as { jobId?: unknown }).jobId;
      if (typeof jobId === "string") {
        return { kind: "job", jobId };
      }
    }
  }
  return { kind: "phone-tab" };
}

// Slice 12 (#316) — Job-page Calls section. Returns every voice call tagged to
// the given Job (job_tag), chronological, with voicemail + recording flattened.
// User-client only: RLS (migration-312) enforces the ADR 0003 access matrix, so
// a row the caller can't see is simply absent — no serviceClient. view_phone
// gates the section (Crew Members lack it and never reach this route).
export const GET = withRequestContext(
  { permission: "view_phone" },
  async (request, ctx) => {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("phone_calls")
      .select(JOB_CALL_FIELDS)
      .eq("job_tag", jobId)
      .order("started_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const calls = ((data ?? []) as Record<string, unknown>[]).map((row) =>
      flattenChild(
        flattenChild(row, "phone_voicemails", "voicemail"),
        "phone_recordings",
        "recording",
      ),
    );
    return NextResponse.json(calls);
  },
);

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const hasConv = typeof body.conversationId === "string";
    const hasOutside = typeof body.outsideE164 === "string";
    if (!hasConv && !hasOutside) {
      return NextResponse.json(
        { error: "conversationId or outsideE164 is required" },
        { status: 400 },
      );
    }

    // Resolve the customer E.164 — the far end of the bridge.
    let outsideE164: string | null = null;
    let existingConversationId: string | null = null;

    if (hasConv) {
      existingConversationId = body.conversationId as string;
      const { data: conv } = await ctx.serviceClient!
        .from("phone_conversations")
        .select("id, organization_id, phone_number_id, outside_e164, contact_id")
        .eq("id", existingConversationId)
        .maybeSingle<{
          id: string;
          organization_id: string;
          phone_number_id: string;
          outside_e164: string;
          contact_id: string | null;
        }>();
      if (!conv || conv.organization_id !== ctx.orgId) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      outsideE164 = conv.outside_e164;
    } else {
      const raw = body.outsideE164 as string;
      const normalized = normalizePhoneToE164(raw);
      if (!normalized || !E164_RE.test(normalized)) {
        return NextResponse.json(
          { error: "outsideE164 is not a valid phone number" },
          { status: 400 },
        );
      }
      outsideE164 = normalized;
    }

    // Outbound-number selection — the caller ID the customer sees. Read every
    // active number in the org and hand them all to the pure rule. The rule
    // only ever returns a number the org actually owns and that is active and
    // un-released, so this is the owned-number safety: a `from` that is not a
    // live Nookleus org number can never be selected.
    const { data: orgNumberRows } = await ctx.serviceClient!
      .from("phone_numbers")
      .select(
        "id, organization_id, twilio_sid, e164, kind, user_id, released_at, is_active, created_at",
      )
      .eq("organization_id", ctx.orgId);
    const orgNumbers = (orgNumberRows ?? []) as Array<
      SelectableNumber & { twilio_sid: string }
    >;

    const selected = selectOutboundNumber({
      callerUserId: ctx.userId,
      organizationId: ctx.orgId ?? "",
      orgNumbers,
    });
    // Bridge calls always use the default selection rule (Personal-if-active,
    // else primary Shared) — the per-message override is a messages-only
    // affordance (#317), so any non-"picked" result here means there is no
    // usable number to call from. Narrowing on "picked" also covers the
    // (unreachable, override-only) "forbidden_override" variant.
    if (selected.kind !== "picked") {
      return NextResponse.json(
        {
          error:
            "No active phone number in this organization to call from. Provision one in Settings → Phone.",
        },
        { status: 422 },
      );
    }
    const fromNumber = selected.number as SelectableNumber & {
      twilio_sid: string;
    };

    // Profile-cell gate. The bridge rings the caller's own cell first; with
    // no cell on file there is nothing to ring, so refuse before Twilio.
    const { data: profile } = await ctx.serviceClient!
      .from("user_profiles")
      .select("phone")
      .eq("id", ctx.userId)
      .maybeSingle<{ phone: string | null }>();
    const crewCell = profile?.phone ? normalizePhoneToE164(profile.phone) : null;
    if (!crewCell || !E164_RE.test(crewCell)) {
      return NextResponse.json(
        {
          error:
            "Add a mobile number to your profile before placing a call — it is the phone we ring first.",
        },
        { status: 422 },
      );
    }

    // Opt-out check. Org-scoped. The customer is opted out if any row exists
    // with re_opted_in_at IS NULL. Refuse before Twilio is ever called.
    const { data: optOuts } = await ctx.serviceClient!
      .from("phone_opt_outs")
      .select("id, re_opted_in_at")
      .eq("organization_id", ctx.orgId)
      .eq("outside_e164", outsideE164)
      .is("re_opted_in_at", null);
    if (optOuts && optOuts.length > 0) {
      return NextResponse.json(
        {
          error:
            "This number has opted out (TCPA). An admin can re-opt-in via Settings → Phone.",
        },
        { status: 403 },
      );
    }

    // Job-ownership gate (#531). A `{ kind:'job' }` source writes its jobId
    // into job_tag, which carries a foreign key to jobs(id). Confirm the Job
    // exists AND belongs to the caller's org BEFORE Twilio and before any DB
    // write — a single query filtered by id + organization_id refuses both a
    // non-existent id (orphan call: rings, then the FK insert fails) and a
    // cross-org id (a row tagged to another org's Job). The happy path never
    // hits this: the Job-page Call button always sends a valid in-org id.
    const source = parseSourceContext(body.sourceContext);
    if (source.kind === "job") {
      const { data: job } = await ctx.serviceClient!
        .from("jobs")
        .select("id, organization_id")
        .eq("id", source.jobId)
        .eq("organization_id", ctx.orgId)
        .maybeSingle<{ id: string; organization_id: string }>();
      if (!job) {
        return NextResponse.json(
          { error: "Job not found in this organization." },
          { status: 422 },
        );
      }
    }

    // Resolve the conversation_id we'll write under — upsert by
    // (phone_number_id, outside_e164), the natural key from migration-308.
    let conversationId: string;
    if (existingConversationId) {
      conversationId = existingConversationId;
    } else {
      const now = new Date().toISOString();
      const { data: convRow } = await ctx.serviceClient!
        .from("phone_conversations")
        .upsert(
          {
            organization_id: ctx.orgId,
            phone_number_id: fromNumber.id,
            outside_e164: outsideE164,
            last_event_at: now,
          },
          { onConflict: "phone_number_id,outside_e164" },
        )
        .select("id")
        .single<{ id: string }>();
      if (!convRow) {
        return NextResponse.json(
          { error: "Failed to create conversation" },
          { status: 500 },
        );
      }
      conversationId = convRow.id;
    }

    // Smart-attach. A Job-page Call auto-tags to that Job; Phone-tab /
    // Contact-card calls are untagged. The rule is given the conversation's
    // contact + their Active jobs for the non-Job sources. (`source` was
    // parsed and ownership-checked above, before Twilio.)
    let activeJobs: ActiveJob[] = [];
    let contactId: string | null = null;
    if (source.kind === "phone-tab" || source.kind === "contact-card") {
      const { data: convForTag } = await ctx.serviceClient!
        .from("phone_conversations")
        .select("contact_id")
        .eq("id", conversationId)
        .maybeSingle<{ contact_id: string | null }>();
      contactId = convForTag?.contact_id ?? null;
      if (contactId) {
        const { data: jobRows } = await ctx.serviceClient!
          .from("jobs")
          .select("id, job_number, status")
          .eq("organization_id", ctx.orgId)
          .eq("contact_id", contactId);
        const ACTIVE = new Set(["new", "in_progress", "pending_invoice"]);
        activeJobs = (jobRows ?? [])
          .filter((j: { status: string }) => ACTIVE.has(j.status))
          .map((j: { id: string; job_number: string }) => ({
            id: j.id,
            label: j.job_number,
          }));
      }
    }
    const smartAttach = decideJobTag({
      direction: "out",
      sourceContext: source,
      contactId,
      activeJobs,
    });
    const jobTag = smartAttach.kind === "auto" ? smartAttach.jobId : null;

    // Slice 11 (#315) — recording decision for this call. Default to the org's
    // recording_enabled_default (NOT NULL default true); a per-call override in
    // the payload (recordCall:false) suppresses recording for THIS call only.
    // When on, the bridge speaks the consent notice to the crew lead, records
    // the conversation dual-channel to the recording-completed webhook, and
    // whispers the same notice to the customer leg.
    const { data: orgRow } = await ctx.serviceClient!
      .from("organizations")
      .select("recording_enabled_default")
      .eq("id", ctx.orgId)
      .maybeSingle<{ recording_enabled_default: boolean }>();
    const overrideRecord =
      typeof body.recordCall === "boolean" ? body.recordCall : undefined;
    const recordCall = overrideRecord ?? orgRow?.recording_enabled_default ?? false;

    // Dispatch via Twilio. The inline bridge TwiML presents the Nookleus
    // number to the customer; `placeBridgeCall` rings the crew lead's cell
    // (`to`) FROM the Nookleus number (`from`) and runs the TwiML on answer.
    const twiml = buildBridgeTwiml({
      customerE164: outsideE164,
      callerId: fromNumber.e164,
      recordCall,
      callRecordingStatusCallback:
        process.env.PHONE_RECORDING_CALLBACK_URL || undefined,
      consentWhisperUrl: process.env.PHONE_RECORDING_WHISPER_URL || undefined,
    });
    const statusCallback =
      process.env.PHONE_VOICE_STATUS_CALLBACK_URL || undefined;
    let dispatch: { sid: string; status: string };
    try {
      dispatch = await placeBridgeCall(createTwilioClient(), {
        from: fromNumber.e164,
        to: crewCell,
        twiml,
        ...(statusCallback ? { statusCallback } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json(
        { error: `Twilio: ${message}` },
        { status: 502 },
      );
    }

    // Persist the call row. The crew lead's cell is a bridge detail and
    // never appears here — the row records the LOGICAL call Nookleus →
    // customer.
    const now = new Date().toISOString();
    const { data: callRow, error: callError } = await ctx.serviceClient!
      .from("phone_calls")
      .insert({
        organization_id: ctx.orgId,
        conversation_id: conversationId,
        direction: "out",
        from_e164: fromNumber.e164,
        to_e164: outsideE164,
        twilio_call_sid: dispatch.sid,
        status: dispatch.status,
        job_tag: jobTag,
        tagged_by_user_id: null,
        initiated_by_user_id: ctx.userId,
        started_at: now,
      })
      .select("id")
      .single<{ id: string }>();
    if (callError || !callRow) {
      return NextResponse.json(
        {
          error:
            "Twilio placed the call but the local row could not be saved.",
        },
        { status: 500 },
      );
    }

    // Bump last_event_at on the conversation.
    await ctx.serviceClient!
      .from("phone_conversations")
      .update({ last_event_at: now })
      .eq("id", conversationId);

    return NextResponse.json(
      {
        id: callRow.id,
        conversationId,
        twilio_call_sid: dispatch.sid,
        status: dispatch.status,
        smartAttach,
      },
      { status: 201 },
    );
  },
);
