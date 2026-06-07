import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createTwilioClient, sendSms } from "@/lib/phone/twilio-client";
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
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";
import {
  signedUrlForPhoneAttachment,
  type PhoneStorageClient,
} from "@/lib/phone/attachments-storage";

// PRD #304 — Nookleus Phone. Slice 5 (#309) — outbound SMS send.
//
// The first communication-outbound surface. A Crew Lead's compose box
// posts here; this route:
//   1. Gates on view_phone (the wrapper) — admins pass by role.
//   2. Resolves the outbound `phone_numbers` row to send FROM (the
//      `select-outbound-number` rule — Personal-if-any-else-Shared).
//   3. Checks the TCPA opt-out registry. If the recipient texted STOP to
//      ANY number in the org, refuse the send — Twilio MUST NOT be
//      called.
//   4. Upserts the `phone_conversations` row (by phone_number_id +
//      outside_e164 — the natural key from migration-308).
//   5. Calls Twilio to dispatch the message. The status callback URL is
//      our own status-callback webhook; Twilio will POST delivery
//      transitions there.
//   6. Inserts the `phone_messages` row with direction='out', the
//      Twilio SID and initial status, plus the smart-attach Job tag.
//
// Ordering note: opt-out check BEFORE Twilio (cheapest path to a refusal),
// Twilio BEFORE DB write (we never want a phone_messages row claiming a
// dispatch that didn't happen). If the DB insert fails after Twilio sent
// the SMS the customer still receives the text; the row is missing
// locally but recoverable from Twilio's logs. This is the lesser evil
// than the inverse (visible message in the app that the customer never
// received).

interface Body {
  conversationId?: unknown;
  outsideE164?: unknown;
  body?: unknown;
  // Slice 5 doesn't expose Job-page Text (that's slice 7); valid sources
  // here are 'phone-tab' and 'contact-card'. A `{ kind: 'job', jobId }`
  // shape is accepted so slice 7 is a one-line change.
  sourceContext?: unknown;
  // Slice 6 (#310) — MMS attachments pre-uploaded via
  // /api/phone/attachments. Each entry is the stored path + the media
  // type the upload route validated.
  attachments?: unknown;
}

interface PersistedAttachment {
  storage_path: string;
  media_type: string;
  filename?: string;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

const SIGNED_MMS_URL_TTL_SECONDS = 600; // 10 minutes — Twilio fetches quickly.

function parseAttachments(input: unknown): PersistedAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: PersistedAttachment[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const storage_path = obj.storage_path;
    const media_type = obj.media_type;
    if (typeof storage_path !== "string" || typeof media_type !== "string") {
      continue;
    }
    const filename =
      typeof obj.filename === "string" ? (obj.filename as string) : undefined;
    out.push({ storage_path, media_type, ...(filename ? { filename } : {}) });
  }
  return out;
}

function parseSourceContext(input: unknown): SmartAttachSource {
  if (input && typeof input === "object" && "kind" in input) {
    const kind = (input as { kind?: unknown }).kind;
    if (kind === "phone-tab" || kind === "contact-card" || kind === "inbound") {
      return { kind };
    }
    if (kind === "job") {
      const jobId = (input as { jobId?: unknown }).jobId;
      if (typeof jobId === "string") {
        return { kind: "job", jobId };
      }
    }
  }
  return { kind: "phone-tab" };
}

// Slice 7 (#311) — the Job-page Messages (N) section reads every text/MMS
// tagged to a Job here. A thin RLS pass-through over the User client,
// mirroring the conversation-thread read route: RLS (migration-308)
// enforces the ADR 0005 access matrix, so a caller who cannot see a row
// simply does not get it back. The section is hidden from anyone without
// view_phone, and so is this endpoint.
const JOB_MESSAGE_FIELDS =
  "id, organization_id, conversation_id, direction, from_e164, to_e164, body, media_urls, twilio_sid, status, job_tag, tagged_by_user_id, sent_by_user_id, sent_at, created_at";

export const GET = withRequestContext(
  { permission: "view_phone" },
  async (request, ctx) => {
    const jobId = new URL(request.url).searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    const { data, error } = await ctx.supabase
      .from("phone_messages")
      .select(JOB_MESSAGE_FIELDS)
      .eq("job_tag", jobId)
      .order("sent_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    // #309 is blocked by #305 (A2P 10DLC). Ship behind the flag — the
    // route is wired but refuses outbound until the campaign clears.
    // Returning 503 (rather than 404 or 403) signals "this feature
    // exists but is not currently available" to a caller.
    if (!isPhoneOutboundEnabled()) {
      return NextResponse.json(
        {
          error:
            "Outbound SMS is not yet available — pending A2P 10DLC carrier registration (#305).",
        },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as Body | null;
    if (!body || typeof body.body !== "string") {
      return NextResponse.json(
        { error: "body is required" },
        { status: 400 },
      );
    }
    const attachments = parseAttachments(body.attachments);
    if (body.body.length === 0 && attachments.length === 0) {
      // Slice 6 (#310) — an MMS may have an empty body iff at least one
      // attachment is present. Reject when both are empty so the send
      // button gate can rely on the route refusing if the UI is bypassed.
      return NextResponse.json(
        { error: "body or attachments required" },
        { status: 400 },
      );
    }
    const messageBody = body.body;

    // Slice 6 (#310) — cross-org safety. The /api/phone/attachments upload
    // route always writes under `{orgId}/...`, so any path that doesn't
    // start with the caller's org id is either a forged reference or a
    // mis-ported one from another org and must be refused before signing.
    for (const a of attachments) {
      if (!a.storage_path.startsWith(`${ctx.orgId}/`)) {
        return NextResponse.json(
          { error: "Attachment outside caller's organization" },
          { status: 403 },
        );
      }
    }

    const hasConv = typeof body.conversationId === "string";
    const hasOutside = typeof body.outsideE164 === "string";
    if (!hasConv && !hasOutside) {
      return NextResponse.json(
        { error: "conversationId or outsideE164 is required" },
        { status: 400 },
      );
    }

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

    // Outbound-number selection. Read every active number in the org and
    // hand them all to the pure rule.
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
    if (selected.kind === "none") {
      return NextResponse.json(
        {
          error:
            "No active phone number in this organization to send from. Provision one in Settings → Phone.",
        },
        { status: 422 },
      );
    }
    const fromNumber = selected.number as SelectableNumber & {
      twilio_sid: string;
    };

    // Opt-out check. Org-scoped. The recipient is opted out if any row
    // exists with re_opted_in_at IS NULL — a re-opt-in clears the block.
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

    // Resolve the conversation_id we'll write under. Upsert by
    // (phone_number_id, outside_e164) — slice 4 wrote the unique
    // constraint on that pair.
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

    // Smart-attach. Slice 5 only ever sees the outbound sources
    // 'phone-tab' / 'contact-card' (Job-page Text is slice 7). The rule
    // covers all three.
    const source = parseSourceContext(body.sourceContext);
    let activeJobs: ActiveJob[] = [];
    let contactId: string | null = null;
    if (source.kind === "phone-tab" || source.kind === "contact-card") {
      // Look up the conversation's contact + their Active jobs.
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

    // Slice 6 (#310) — mint a short-lived signed URL per attachment for
    // Twilio to fetch from. We keep the storage path (not the URL) on
    // the persisted row, since signed URLs expire — the bucket object
    // is the durable record.
    let mediaUrl: string[] | undefined;
    if (attachments.length > 0) {
      try {
        mediaUrl = await Promise.all(
          attachments.map((a) =>
            signedUrlForPhoneAttachment(
              ctx.serviceClient as unknown as PhoneStorageClient,
              a.storage_path,
              SIGNED_MMS_URL_TTL_SECONDS,
            ),
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "attachment sign failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    // Dispatch via Twilio.
    const statusCallback = process.env.PHONE_STATUS_CALLBACK_URL || undefined;
    let dispatch: { sid: string; status: string };
    try {
      dispatch = await sendSms(createTwilioClient(), {
        from: fromNumber.e164,
        to: outsideE164,
        body: messageBody,
        statusCallback,
        ...(mediaUrl ? { mediaUrl } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Twilio error";
      return NextResponse.json(
        { error: `Twilio: ${message}` },
        { status: 502 },
      );
    }

    // Persist the message row.
    const now = new Date().toISOString();
    const { data: msgRow, error: msgError } = await ctx.serviceClient!
      .from("phone_messages")
      .insert({
        organization_id: ctx.orgId,
        conversation_id: conversationId,
        direction: "out",
        from_e164: fromNumber.e164,
        to_e164: outsideE164,
        body: messageBody,
        media_urls: attachments,
        twilio_sid: dispatch.sid,
        status: dispatch.status,
        job_tag: jobTag,
        tagged_by_user_id: null,
        sent_by_user_id: ctx.userId,
        sent_at: now,
      })
      .select("id")
      .single<{ id: string }>();
    if (msgError || !msgRow) {
      return NextResponse.json(
        {
          error:
            "Twilio dispatched the message but the local row could not be saved.",
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
        id: msgRow.id,
        conversationId,
        twilio_sid: dispatch.sid,
        status: dispatch.status,
        smartAttach,
      },
      { status: 201 },
    );
  },
);
