import { describe, it, expect } from "vitest";
import type { Email } from "@/lib/types";
import { buildQuotedReply } from "./build-quoted-reply";
import { buildReplyComposeSeed } from "./reply-compose-seed";

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "e1",
    account_id: "received-on-account",
    job_id: "job-7",
    message_id: "m1@x",
    thread_id: null,
    folder: "inbox",
    from_address: "jane@example.com",
    from_name: "Jane Doe",
    to_addresses: [{ email: "me@example.com" }],
    cc_addresses: [],
    bcc_addresses: [],
    subject: "Roof estimate",
    body_text: null,
    body_html: "<p>Hi there.</p>",
    snippet: null,
    is_read: true,
    is_starred: false,
    has_attachments: false,
    matched_by: null,
    category: null,
    uid: null,
    received_at: "2024-03-15T14:30:00",
    created_at: "2024-03-15T14:30:00",
    organization_id: "org-1",
    ...overrides,
  };
}

describe("buildReplyComposeSeed — reply", () => {
  it("sends from the account that received the message and addresses the original sender", () => {
    const seed = buildReplyComposeSeed(makeEmail(), "reply");
    // The whole point of #660: a reply must go out from the receiving account,
    // not whatever account happens to be the compose default.
    expect(seed.accountId).toBe("received-on-account");
    expect(seed.mode).toBe("reply");
    expect(seed.to).toBe("jane@example.com");
    expect(seed.cc).toBe("");
    expect(seed.subject).toBe("Re: Roof estimate");
    expect(seed.messageId).toBe("m1@x");
    expect(seed.jobId).toBe("job-7");
    expect(seed.body).toBe(buildQuotedReply(makeEmail()));
  });

  it("does not double-stamp an existing Re: subject", () => {
    const seed = buildReplyComposeSeed(makeEmail({ subject: "Re: Roof estimate" }), "reply");
    expect(seed.subject).toBe("Re: Roof estimate");
  });
});

describe("buildReplyComposeSeed — reply-all", () => {
  it("CCs the other recipients but never the user's own account or the original sender", () => {
    const email = makeEmail({
      from_address: "jane@example.com",
      to_addresses: [
        { email: "me@example.com" },
        { email: "bob@example.com" },
      ],
      cc_addresses: [
        { email: "carol@example.com" },
        { email: "Jane@example.com" }, // sender again, different case — must drop
      ],
    });
    const seed = buildReplyComposeSeed(email, "reply-all", ["ME@example.com"]);
    // Still a reply window, still sent from the receiving account.
    expect(seed.mode).toBe("reply");
    expect(seed.accountId).toBe("received-on-account");
    expect(seed.to).toBe("jane@example.com");
    // me@ (own, case-insensitive) and jane@ (sender) stripped; the rest kept in order.
    expect(seed.cc).toBe("bob@example.com, carol@example.com");
  });

  it("falls back to an empty CC when there is no one else to copy", () => {
    const email = makeEmail({
      from_address: "jane@example.com",
      to_addresses: [{ email: "me@example.com" }],
      cc_addresses: [],
    });
    const seed = buildReplyComposeSeed(email, "reply-all", ["me@example.com"]);
    expect(seed.cc).toBe("");
  });
});

describe("buildReplyComposeSeed — forward", () => {
  it("opens a forward window from the receiving account with empty recipients", () => {
    const seed = buildReplyComposeSeed(makeEmail(), "forward");
    expect(seed.mode).toBe("forward");
    expect(seed.accountId).toBe("received-on-account");
    expect(seed.to).toBe("");
    expect(seed.cc).toBe("");
    expect(seed.subject).toBe("Fwd: Roof estimate");
    expect(seed.body).toBe(buildQuotedReply(makeEmail()));
    expect(seed.messageId).toBe("m1@x");
    expect(seed.jobId).toBe("job-7");
  });

  it("does not double-stamp an existing Fwd: subject", () => {
    const seed = buildReplyComposeSeed(makeEmail({ subject: "Fwd: Roof estimate" }), "forward");
    expect(seed.subject).toBe("Fwd: Roof estimate");
  });
});
