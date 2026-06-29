// Issue #605 — Marketing suite: manual review request from the Job page.
//
// Pure logic for the "Request review" action: derive the Organization's
// direct Google review link, pick the send channel from the customer's
// contact details, build the SMS/email copy, and summarise prior sends so
// the UI can warn before double-asking the same customer. No I/O here — the
// API route and the Business Profile fetcher (src/lib/google/business-profile.ts)
// supply the data and perform the sends. See PRD #603 / ADR 0015.

import { normalizePhoneToE164 } from "@/lib/phone";

export interface ReviewLinkSource {
  // Google's canonical "leave a review" deep link for the location, when the
  // Business Profile metadata carries it.
  newReviewUri?: string | null;
  // The Place ID, used to construct the writereview URL when newReviewUri is
  // absent.
  placeId?: string | null;
}

/**
 * The direct Google review URL for the connected Business Profile location,
 * or null when the metadata carries neither a review URI nor a Place ID.
 */
export function buildReviewLink(source: ReviewLinkSource): string | null {
  const newReviewUri = source.newReviewUri?.trim();
  if (newReviewUri) return newReviewUri;
  const placeId = source.placeId?.trim();
  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${placeId}`;
  }
  return null;
}

// --- Channel selection -----------------------------------------------------

// The customer contact fields the channel rule cares about. A structural
// subset of Contact (src/lib/types.ts) so callers can pass a Contact directly.
export interface ReviewRequestContactInfo {
  phone: string | null;
  email: string | null;
}

export type ReviewRequestChannel =
  // Send the review request as an SMS to this E.164 number.
  | { channel: "sms"; to: string }
  // Send the review request as an email to this address.
  | { channel: "email"; to: string }
  // The customer has no usable way to receive the request.
  | { channel: "none"; reason: "no_contact_method" };

/**
 * Chooses how to reach the customer with a review request: SMS when the phone
 * normalizes to a US E.164 number, otherwise email when an address is present,
 * otherwise none. Contact carries a single `phone` field, so "no mobile" is
 * simply "no usable phone".
 */
export function selectReviewRequestChannel(
  contact: ReviewRequestContactInfo,
): ReviewRequestChannel {
  const e164 = normalizePhoneToE164(contact.phone ?? "");
  if (e164) return { channel: "sms", to: e164 };
  const email = contact.email?.trim();
  if (email) return { channel: "email", to: email };
  return { channel: "none", reason: "no_contact_method" };
}

// --- Message copy ----------------------------------------------------------

export interface ReviewRequestMessageInput {
  channel: "sms" | "email";
  businessName: string;
  reviewLink: string;
  // The customer's name, used for a personalized greeting when present.
  customerName?: string | null;
}

// Plain-text copy. For email, `subject` is set and `body` is the plain-text
// message; the route wraps `body` into HTML for sendOrgEmail. For SMS,
// `subject` is undefined and `body` is the full message text.
export interface ReviewRequestMessage {
  subject?: string;
  body: string;
}

/**
 * Builds the review-request copy for the chosen channel: a single SMS line, or
 * an email subject + body. Both mention the business and carry the review link.
 */
export function buildReviewRequestMessage(
  input: ReviewRequestMessageInput,
): ReviewRequestMessage {
  const firstName = input.customerName?.trim().split(/\s+/)[0] ?? "";
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const body = `${greeting} Thanks for choosing ${input.businessName}! If you have a moment, we'd really appreciate a quick review: ${input.reviewLink}`;
  if (input.channel === "email") {
    return { subject: `How did we do? — ${input.businessName}`, body };
  }
  return { body };
}

// --- Prior-send summary (double-send detection) ----------------------------

// One prior review request for a job, as logged in the review_requests table.
export interface PriorReviewRequest {
  channel: "sms" | "email";
  created_at: string; // ISO timestamp
  sender_name?: string | null;
}

export interface PriorReviewRequestSummary {
  // True when this customer has already been asked at least once — the UI
  // warns before sending again.
  alreadyRequested: boolean;
  count: number;
  // The most recent prior request, or null when there are none.
  last: PriorReviewRequest | null;
}

/**
 * Summarises a job's prior review requests so the UI can warn before
 * double-asking the same customer. `last` is the most recent by `created_at`,
 * independent of the order the rows arrive in.
 */
export function summarizePriorReviewRequests(
  rows: PriorReviewRequest[],
): PriorReviewRequestSummary {
  const last = rows.reduce<PriorReviewRequest | null>((latest, row) => {
    if (!latest || row.created_at > latest.created_at) return row;
    return latest;
  }, null);
  return {
    alreadyRequested: rows.length > 0,
    count: rows.length,
    last,
  };
}
