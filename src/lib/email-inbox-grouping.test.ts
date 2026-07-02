import { describe, expect, it } from "vitest";

import { groupInbox, type BotSenderIdentity } from "./email-inbox-grouping";
import type { Email } from "./types";

/** Minimal Email fixture — only the fields the grouping engine reads matter. */
function makeEmail(overrides: Partial<Email>): Email {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    account_id: "acct-1",
    job_id: null,
    message_id: "<msg>",
    thread_id: null,
    folder: "inbox",
    from_address: "someone@example.com",
    from_name: "Someone",
    to_addresses: [],
    cc_addresses: [],
    bcc_addresses: [],
    subject: "Subject",
    body_text: null,
    body_html: null,
    snippet: null,
    is_read: false,
    is_starred: false,
    has_attachments: false,
    matched_by: null,
    category: "general",
    uid: null,
    received_at: "2026-07-01T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    organization_id: "org-1",
    ...overrides,
  };
}

const noBots: BotSenderIdentity[] = [];

describe("groupInbox — human mail passthrough", () => {
  it("returns all mail as human rows in order when there are no bot senders", () => {
    const a = makeEmail({ from_address: "jane@example.com", received_at: "2026-07-02T10:00:00.000Z" });
    const b = makeEmail({ from_address: "bob@example.com", received_at: "2026-07-01T10:00:00.000Z" });

    const result = groupInbox([a, b], noBots);

    expect(result.humanRows).toEqual([a, b]);
    expect(result.senderGroups).toEqual([]);
    expect(result.olderUpdates).toBeNull();
  });
});

describe("groupInbox — unread bot mail forms one group per sender", () => {
  it("collapses a bot sender's unread mail into a group and keeps humans separate", () => {
    const human = makeEmail({ from_address: "jane@example.com" });
    const bot1 = makeEmail({
      from_address: "notifications@github.com",
      from_name: "vercel[bot]",
      snippet: "Deployment ready",
      received_at: "2026-07-02T12:00:00.000Z",
      is_read: false,
    });
    const bot2 = makeEmail({
      from_address: "notifications@github.com",
      from_name: "vercel[bot]",
      snippet: "Build started",
      received_at: "2026-07-01T09:00:00.000Z",
      is_read: false,
    });

    const bots: BotSenderIdentity[] = [
      { name: "vercel[bot]", address: "notifications@github.com" },
    ];

    const result = groupInbox([bot1, human, bot2], bots);

    expect(result.humanRows).toEqual([human]);
    expect(result.senderGroups).toHaveLength(1);

    const group = result.senderGroups[0];
    expect(group.address).toBe("notifications@github.com");
    expect(group.name).toBe("vercel[bot]");
    expect(group.unreadCount).toBe(2);
    expect(group.emails).toEqual([bot1, bot2]);
    expect(group.latestSnippet).toBe("Deployment ready");
    expect(group.latestReceivedAt).toBe("2026-07-02T12:00:00.000Z");
    expect(result.olderUpdates).toBeNull();
  });

  it("splits mail from one address but two display names into two groups", () => {
    const vercel = makeEmail({
      from_address: "notifications@github.com",
      from_name: "vercel[bot]",
      is_read: false,
    });
    const ci = makeEmail({
      from_address: "notifications@github.com",
      from_name: "GitHub CI",
      is_read: false,
    });

    const bots: BotSenderIdentity[] = [
      { name: "vercel[bot]", address: "notifications@github.com" },
      { name: "GitHub CI", address: "notifications@github.com" },
    ];

    const result = groupInbox([vercel, ci], bots);

    expect(result.senderGroups).toHaveLength(2);
    const names = result.senderGroups.map((g) => g.name).sort();
    expect(names).toEqual(["GitHub CI", "vercel[bot]"]);
    for (const g of result.senderGroups) {
      expect(g.address).toBe("notifications@github.com");
      expect(g.unreadCount).toBe(1);
    }
  });
});

describe("groupInbox — read bot mail drains to Older updates", () => {
  it("aggregates read bot mail from all senders into one Older updates row", () => {
    const readA = makeEmail({
      from_address: "no-reply@a.com",
      from_name: "Service A",
      is_read: true,
      received_at: "2026-06-30T08:00:00.000Z",
    });
    const readB = makeEmail({
      from_address: "no-reply@b.com",
      from_name: "Service B",
      is_read: true,
      received_at: "2026-07-01T08:00:00.000Z",
    });

    const bots: BotSenderIdentity[] = [
      { name: "Service A", address: "no-reply@a.com" },
      { name: "Service B", address: "no-reply@b.com" },
    ];

    const result = groupInbox([readB, readA], bots);

    expect(result.senderGroups).toEqual([]);
    expect(result.humanRows).toEqual([]);
    expect(result.olderUpdates).not.toBeNull();
    expect(result.olderUpdates!.count).toBe(2);
    expect(result.olderUpdates!.emails).toEqual([readB, readA]);
    expect(result.olderUpdates!.latestReceivedAt).toBe("2026-07-01T08:00:00.000Z");
  });

  it("groups a bot sender's unread mail while its read mail drains to Older updates", () => {
    const unread = makeEmail({
      from_address: "no-reply@a.com",
      from_name: "Service A",
      is_read: false,
      received_at: "2026-07-02T08:00:00.000Z",
    });
    const read = makeEmail({
      from_address: "no-reply@a.com",
      from_name: "Service A",
      is_read: true,
      received_at: "2026-06-01T08:00:00.000Z",
    });

    const bots: BotSenderIdentity[] = [{ name: "Service A", address: "no-reply@a.com" }];

    const result = groupInbox([unread, read], bots);

    expect(result.senderGroups).toHaveLength(1);
    expect(result.senderGroups[0].unreadCount).toBe(1);
    expect(result.senderGroups[0].emails).toEqual([unread]);
    expect(result.olderUpdates!.count).toBe(1);
    expect(result.olderUpdates!.emails).toEqual([read]);
  });
});

describe("groupInbox — boundaries", () => {
  it("returns empty structures for an empty inbox", () => {
    const result = groupInbox([], [{ name: "vercel[bot]", address: "notifications@github.com" }]);

    expect(result.humanRows).toEqual([]);
    expect(result.senderGroups).toEqual([]);
    expect(result.olderUpdates).toBeNull();
  });

  it("treats an unregistered name from a registered bot address as human mail", () => {
    // Only "vercel[bot]" is a known bot sender; "GitHub CI" at the same
    // address is not yet registered, so its mail stays a plain human row.
    const unregistered = makeEmail({
      from_address: "notifications@github.com",
      from_name: "GitHub CI",
      is_read: false,
    });

    const bots: BotSenderIdentity[] = [
      { name: "vercel[bot]", address: "notifications@github.com" },
    ];

    const result = groupInbox([unregistered], bots);

    expect(result.humanRows).toEqual([unregistered]);
    expect(result.senderGroups).toEqual([]);
    expect(result.olderUpdates).toBeNull();
  });

  it("matches identities case-insensitively and ignoring surrounding whitespace", () => {
    const bot = makeEmail({
      from_address: "No-Reply@GitHub.com",
      from_name: "  Vercel[bot]  ",
      is_read: false,
    });

    const bots: BotSenderIdentity[] = [
      { name: "vercel[bot]", address: "no-reply@github.com" },
    ];

    const result = groupInbox([bot], bots);

    expect(result.senderGroups).toHaveLength(1);
    expect(result.senderGroups[0].unreadCount).toBe(1);
  });
});
