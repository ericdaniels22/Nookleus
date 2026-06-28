// Compose seed for Reply / Reply-All / Forward (issue #660).
//
// The bug: replies went out from whatever account happened to be the compose
// default, not the account that received the message. This pure helper centralises
// the decision — which account sends, who's addressed, the Re:/Fwd: subject, and
// the quoted body — so the three inbox launchers (and their tests) share one
// source of truth instead of re-deriving it inline.

import type { Email } from "@/lib/types";
import { buildQuotedReply } from "./build-quoted-reply";

export type ReplyKind = "reply" | "reply-all" | "forward";

export interface ReplyComposeSeed {
  /** Drives the compose window title; reply-all is still a "reply" window. */
  mode: "reply" | "forward";
  /** The account that received the message — what #660 is all about. */
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  messageId: string;
  jobId: string;
}

/**
 * Build the compose seed for replying to / forwarding an email.
 *
 * `ownAddresses` are the user's own connected-account addresses; on reply-all
 * they're stripped from the CC list (you don't CC yourself), along with the
 * original sender (who's already on the To line).
 */
export function buildReplyComposeSeed(
  email: Email,
  kind: ReplyKind,
  ownAddresses: string[] = [],
): ReplyComposeSeed {
  const body = buildQuotedReply(email);
  const accountId = email.account_id;
  const jobId = email.job_id || "";
  const messageId = email.message_id;

  if (kind === "forward") {
    return {
      mode: "forward",
      accountId,
      to: "",
      cc: "",
      bcc: "",
      subject: email.subject.startsWith("Fwd:")
        ? email.subject
        : `Fwd: ${email.subject}`,
      body,
      messageId,
      jobId,
    };
  }

  const subject = email.subject.startsWith("Re:")
    ? email.subject
    : `Re: ${email.subject}`;

  let cc = "";
  if (kind === "reply-all") {
    const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
    const sender = email.from_address.toLowerCase();
    const others = [
      ...(email.to_addresses || []),
      ...(email.cc_addresses || []),
    ].filter((r) => {
      const e = r.email.toLowerCase();
      return !own.has(e) && e !== sender;
    });
    cc = others.map((r) => r.email).join(", ");
  }

  return {
    mode: "reply",
    accountId,
    to: email.from_address,
    cc,
    bcc: "",
    subject,
    body,
    messageId,
    jobId,
  };
}
