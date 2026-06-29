import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createTwilioClient, sendSms } from "@/lib/phone/twilio-client";
import {
  selectOutboundNumber,
  type SelectableNumber,
} from "@/lib/phone/select-outbound-number";
import { isPhoneOutboundEnabled } from "@/lib/phone/feature-flags";
import { sendOrgEmail, FromUnconfiguredError } from "@/lib/email/send";
import { getOrganizationReviewTarget } from "@/lib/google/business-profile";
import {
  selectReviewRequestChannel,
  buildReviewRequestMessage,
  summarizePriorReviewRequests,
  type PriorReviewRequest,
} from "@/lib/reviews/review-request";

// Issue #605 (parent PRD #603, ADR 0015) — Marketing suite: manual review
// request from the Job page.
//
// GET  → the Job's review-request send history (admin), so the UI can show
//        what's been asked and warn before double-asking.
// POST → send ONE review request to the Job's customer and log it. There are
//        NO automatic or scheduled sends; every row is an admin clicking the
//        button.
//
// The send path mirrors the proven outbound surfaces:
//   * channel rule (pure) picks SMS when the contact has a usable phone, else
//     email — selectReviewRequestChannel.
//   * SMS rides the existing Twilio path (select-outbound-number + sendSms),
//     gated by the A2P 10DLC flag (#305). When SMS is gated but the contact
//     has an email, we fall back to email rather than refuse.
//   * email rides the existing Resend/SMTP path (sendOrgEmail).
//
// Ordering note (same lesser-evil rule as /api/phone/messages): dispatch BEFORE
// the DB write, so we never log a send that didn't happen. If the log insert
// fails after dispatch the customer still got the request; the row is missing
// locally (500 surfaced) but the send is real.

interface Body {
  // The UI re-POSTs with `acknowledged: true` after the double-send warning,
  // confirming the admin really means to ask this customer again.
  acknowledged?: unknown;
}

interface JobRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
}

interface ContactRow {
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

// The history fields the Job page reads back, most-recent first.
const HISTORY_FIELDS =
  "id, channel, sent_to, review_link, sent_by_user_id, sent_by_name, created_at";

export const GET = withRequestContext(
  { adminOnly: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    // RLS (migration-605) scopes the read to the caller's active org; the job
    // filter narrows it to this Job's history.
    const { data, error } = await ctx.supabase
      .from("review_requests")
      .select(HISTORY_FIELDS)
      .eq("job_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  },
);

export const POST = withRequestContext(
  { adminOnly: true, serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const db = ctx.serviceClient!;
    const orgId = ctx.orgId!;

    const body = (await request.json().catch(() => null)) as Body | null;
    const acknowledged = body?.acknowledged === true;

    // 1. The Job, scoped to the caller's org. A cross-org or nonexistent id is
    //    indistinguishable — both 404, no existence oracle.
    const { data: job } = await db
      .from("jobs")
      .select("id, organization_id, contact_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .maybeSingle<JobRow>();
    if (!job) {
      return NextResponse.json(
        { error: "Job not found in this organization." },
        { status: 404 },
      );
    }

    // 2. The customer contact (phone/email/name). A Job with no linked contact
    //    has no one to ask.
    let contact: ContactRow = { phone: null, email: null, full_name: null };
    if (job.contact_id) {
      const { data: contactRow } = await db
        .from("contacts")
        .select("phone, email, full_name")
        .eq("id", job.contact_id)
        .maybeSingle<ContactRow>();
      if (contactRow) contact = contactRow;
    }

    // 3. Channel selection (pure): SMS when the phone normalizes, else email.
    let selection = selectReviewRequestChannel({
      phone: contact.phone,
      email: contact.email,
    });
    if (selection.channel === "none") {
      return NextResponse.json(
        {
          error:
            "This customer has no phone number or email on file to send a review request to.",
        },
        { status: 422 },
      );
    }

    // 3a. A2P 10DLC gate (#305). The SMS path is unavailable until the campaign
    //     clears carrier review. Fall back to email when the contact has one;
    //     otherwise refuse with 503 (feature exists, not yet available).
    if (selection.channel === "sms" && !isPhoneOutboundEnabled()) {
      const email = contact.email?.trim();
      if (email) {
        selection = { channel: "email", to: email };
      } else {
        return NextResponse.json(
          {
            error:
              "Outbound SMS is not yet available (pending A2P 10DLC carrier registration), and this customer has no email on file.",
          },
          { status: 503 },
        );
      }
    }

    // 4. Double-send guard. Warn — don't block — before asking the same
    //    customer again: the admin can confirm by re-sending with `acknowledged`.
    const { data: priorRows } = await db
      .from("review_requests")
      .select("channel, created_at, sent_by_name")
      .eq("job_id", id)
      .order("created_at", { ascending: false });
    const prior: PriorReviewRequest[] = (
      (priorRows ?? []) as Array<{
        channel: "sms" | "email";
        created_at: string;
        sent_by_name: string | null;
      }>
    ).map((r) => ({
      channel: r.channel,
      created_at: r.created_at,
      sender_name: r.sent_by_name,
    }));
    const summary = summarizePriorReviewRequests(prior);
    if (summary.alreadyRequested && !acknowledged) {
      return NextResponse.json(
        {
          error: "already_requested",
          message:
            "This customer has already been asked for a review. Send another request?",
          summary,
        },
        { status: 409 },
      );
    }

    // 5. The review target (link + business name). Throws on a genuine Google
    //    outage (502); null means no connection / no link to send (422).
    let target;
    try {
      target = await getOrganizationReviewTarget(db, orgId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Google Business Profile error";
      return NextResponse.json(
        { error: `Could not reach Google Business Profile: ${message}` },
        { status: 502 },
      );
    }
    if (!target) {
      return NextResponse.json(
        {
          error:
            "No Google review link is available. Connect your Google Business Profile in Settings, then try again.",
        },
        { status: 422 },
      );
    }

    // 6. The copy (pure). Email gets a subject; SMS is a single line.
    const message = buildReviewRequestMessage({
      channel: selection.channel,
      businessName: target.businessName,
      reviewLink: target.reviewLink,
      customerName: contact.full_name,
    });

    // 7. Sender display-name snapshot, so the history reads "Eric sent…".
    const { data: profile } = await db
      .from("user_profiles")
      .select("full_name")
      .eq("id", ctx.userId)
      .maybeSingle<{ full_name: string | null }>();
    const senderName = profile?.full_name?.trim() || null;

    // 8. Dispatch — BEFORE the DB write.
    if (selection.channel === "sms") {
      const { data: orgNumberRows } = await db
        .from("phone_numbers")
        .select(
          "id, organization_id, twilio_sid, e164, kind, user_id, released_at, is_active, created_at",
        )
        .eq("organization_id", orgId);
      const orgNumbers = (orgNumberRows ?? []) as Array<
        SelectableNumber & { twilio_sid: string }
      >;
      const selected = selectOutboundNumber({
        callerUserId: ctx.userId,
        organizationId: orgId,
        orgNumbers,
      });
      if (selected.kind !== "picked") {
        return NextResponse.json(
          {
            error:
              "No active phone number in this organization to send from. Provision one in Settings → Phone.",
          },
          { status: 422 },
        );
      }
      const messagingServiceSid =
        process.env.TWILIO_MESSAGING_SERVICE_SID || undefined;
      try {
        await sendSms(createTwilioClient(), {
          from: selected.number.e164,
          to: selection.to,
          body: message.body,
          ...(messagingServiceSid ? { messagingServiceSid } : {}),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Twilio error";
        return NextResponse.json({ error: `Twilio: ${msg}` }, { status: 502 });
      }
    } else {
      try {
        await sendOrgEmail(db, orgId, {
          to: selection.to,
          subject: message.subject!,
          html: reviewEmailHtml(message.body, target.reviewLink),
        });
      } catch (err) {
        if (err instanceof FromUnconfiguredError) {
          return NextResponse.json(
            {
              error:
                "This organization has no send-from email configured. Set one in Settings → Email, then try again.",
            },
            { status: 422 },
          );
        }
        const msg = err instanceof Error ? err.message : "Email error";
        return NextResponse.json({ error: `Email: ${msg}` }, { status: 502 });
      }
    }

    // 9. Log the send. If this fails after dispatch, the customer still got the
    //    request — surface 500 so the admin knows the history is incomplete.
    const { error: insertError } = await db.from("review_requests").insert({
      organization_id: orgId,
      job_id: id,
      contact_id: job.contact_id,
      channel: selection.channel,
      sent_to: selection.to,
      review_link: target.reviewLink,
      sent_by_user_id: ctx.userId,
      sent_by_name: senderName,
    });
    if (insertError) {
      return NextResponse.json(
        {
          error:
            "The review request was sent, but logging it failed. The history may be incomplete.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        channel: selection.channel,
        sentTo: selection.to,
        reviewLink: target.reviewLink,
        sentByName: senderName,
      },
      { status: 201 },
    );
  },
);

// Wrap the plain-text body into minimal HTML for sendOrgEmail, turning the
// review link into a clickable anchor. Everything is escaped first; the link
// occurrence in the (escaped) body is then upgraded to an <a>.
function reviewEmailHtml(body: string, link: string): string {
  const escapedLink = escapeHtml(link);
  const anchored = escapeHtml(body).replace(
    escapedLink,
    `<a href="${escapedLink}">${escapedLink}</a>`,
  );
  return `<p>${anchored}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
