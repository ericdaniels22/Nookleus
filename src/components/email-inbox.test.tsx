import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";

// #142 — the inbox account switcher must offer exactly the accounts the
// caller can read: Shared accounts in their Organization plus their own
// Personal accounts. The switcher gets that set straight from the default
// GET /api/email/accounts view, which #141 already scoped to the caller's
// canRead set. This test pins the switcher to that response so a future
// change (e.g. fetching the ?asAdmin view) can't leak others' Personal
// accounts into the picker.

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/lib/email/use-email-sync", () => ({
  useEmailSync: () => ({
    syncing: false,
    lastSyncedAt: null,
    syncFailed: false,
    syncSilent: vi.fn(),
    syncVisible: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Subcomponents whose internals aren't under test.
vi.mock("@/components/email-reader", () => ({ default: () => null }));
vi.mock("@/components/compose-email", () => ({ default: () => null }));
vi.mock("@/components/email/icon-rail", () => ({ default: () => null }));
vi.mock("@/components/email/category-tabs", () => ({ default: () => null }));

import EmailInbox from "./email-inbox";

function emailAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    user_id: null,
    label: "Account",
    email_address: "a@example.com",
    display_name: "AAA",
    provider: "hostinger",
    imap_host: "imap.example.com",
    imap_port: 993,
    smtp_host: "smtp.example.com",
    smtp_port: 465,
    username: "a@example.com",
    encrypted_password: "",
    signature: null,
    is_active: true,
    is_default: false,
    color: "#2563eb",
    last_synced_at: null,
    last_synced_uid: null,
    created_at: "2026-05-20T00:00:00Z",
    updated_at: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

function email(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    account_id: "acc-1",
    job_id: null,
    from_address: "sender@example.com",
    from_name: "Sender",
    to_addresses: [{ email: "me@example.com" }],
    cc_addresses: [],
    bcc_addresses: [],
    subject: "Quarterly report",
    snippet: "the snippet",
    is_read: true,
    is_starred: false,
    has_attachments: false,
    received_at: "2026-06-01T10:00:00Z",
    job: null,
    ...overrides,
  };
}

function stubFetch(
  accounts: Record<string, unknown>[],
  emails: Record<string, unknown>[] = [],
) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string) => {
    if (url.startsWith("/api/email/accounts")) return json(accounts);
    if (url.startsWith("/api/email/list"))
      return json({
        emails,
        total: emails.length,
        page: 1,
        hasMore: false,
      });
    if (url.startsWith("/api/email/counts")) return json({});
    return json({});
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EmailInbox account switcher (#142)", () => {
  it("lists exactly the accounts GET /api/email/accounts returns — the caller's canRead set", async () => {
    // The default view is the caller's canRead set: a Shared account plus
    // their own Personal account. A Personal account owned by another user
    // is never in this response, so it can't reach the switcher.
    const canRead = [
      emailAccount({ id: "shared-1", user_id: null, label: "Front Desk" }),
      emailAccount({ id: "personal-mine", user_id: "me", label: "My Inbox" }),
    ];
    const spy = stubFetch(canRead);

    render(<EmailInbox />);

    const switcher = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(
        within(switcher).getByRole("option", { name: "Front Desk" }),
      ).toBeDefined();
    });

    // Every account from the route response is offered…
    expect(
      within(switcher).getByRole("option", { name: "My Inbox" }),
    ).toBeDefined();
    // …and nothing the route did not return. The static "All Inboxes"
    // entry is the only extra: exactly canRead.length + 1 options.
    expect(within(switcher).getAllByRole("option")).toHaveLength(
      canRead.length + 1,
    );

    // The switcher's only account source is the default route — it never
    // requests the admin (?asAdmin) view that would surface others'
    // Personal accounts.
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/api/email/accounts"))).toBe(true);
    expect(urls.some((u) => u.includes("asAdmin"))).toBe(false);
  });
});

// #955 — account-color row wash. In the mixed All-Inboxes view every list row
// carries a subtle full-row wash in its Email account's color so it's obvious
// which mailbox received it. Filtering to one account makes the wash redundant,
// so it disappears. The wash is the account hex softened to a low-alpha rgba
// (see account-wash.ts) applied as the row's inline background.
describe("EmailInbox account-color row wash (#955)", () => {
  const TWO_ACCOUNTS = [
    emailAccount({ id: "acc-1", label: "AAA Contracting", color: "#2563EB" }),
    emailAccount({ id: "acc-2", label: "Disaster Recovery", color: "#D97706" }),
  ];
  // account-1's #2563EB softened to the row wash.
  const ACC1_WASH = "rgba(37, 99, 235, 0.1)";
  const washed = (container: HTMLElement) =>
    container.querySelector(`[style*="${ACC1_WASH}"]`);

  it("washes each row in its account color in the mixed All-Inboxes view", async () => {
    stubFetch(TWO_ACCOUNTS, [email({ id: "e1", account_id: "acc-1" })]);
    const { container } = render(<EmailInbox />);

    // The row renders once the list resolves.
    await screen.findByText("Quarterly report");
    // Default scope is "All Inboxes" (no account filter) → mixed view → washed.
    await waitFor(() => expect(washed(container)).not.toBeNull());
  });

  it("drops the wash when filtered to a single account", async () => {
    stubFetch(TWO_ACCOUNTS, [email({ id: "e1", account_id: "acc-1" })]);
    const { container } = render(<EmailInbox />);
    await screen.findByText("Quarterly report");
    await waitFor(() => expect(washed(container)).not.toBeNull());

    // Filter to account-1: the wash is now redundant and must disappear.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "acc-1" },
    });
    await waitFor(() => expect(washed(container)).toBeNull());
  });

  it("does not wash rows when only one account is connected", async () => {
    stubFetch(
      [emailAccount({ id: "acc-1", color: "#2563EB" })],
      [email({ id: "e1", account_id: "acc-1" })],
    );
    const { container } = render(<EmailInbox />);
    await screen.findByText("Quarterly report");
    // Single-account inbox: nothing to disambiguate, so no wash.
    await waitFor(() => expect(washed(container)).toBeNull());
  });
});

// #955 — because the row background now signals the account, unread signaling
// moves to an accent dot + bold sender/subject on every viewport. The old
// background-tint unread treatment goes away entirely. Single account here so
// the account wash doesn't confound the assertions.
describe("EmailInbox unread signaling (#955)", () => {
  const ONE_ACCOUNT = [emailAccount({ id: "acc-1", color: "#2563EB" })];

  function rowFor(subject: string): HTMLElement {
    const el = screen.getByText(subject).closest(".cursor-pointer");
    if (!el) throw new Error(`no row for "${subject}"`);
    return el as HTMLElement;
  }

  it("marks an unread row with an accent dot and bold sender + subject", async () => {
    stubFetch(ONE_ACCOUNT, [
      email({ id: "e1", account_id: "acc-1", is_read: false }),
    ]);
    render(<EmailInbox />);
    await screen.findByText("Quarterly report");

    // Accent dot present…
    expect(screen.getByLabelText("Unread")).toBeDefined();
    // …sender and subject both bold.
    expect(screen.getByText("Sender").className).toContain("font-semibold");
    expect(screen.getByText("Quarterly report").className).toContain(
      "font-semibold",
    );
  });

  it("gives a read row no dot and no bold text", async () => {
    stubFetch(ONE_ACCOUNT, [
      email({ id: "e1", account_id: "acc-1", is_read: true }),
    ]);
    render(<EmailInbox />);
    await screen.findByText("Quarterly report");

    expect(screen.queryByLabelText("Unread")).toBeNull();
    expect(screen.getByText("Sender").className).not.toContain("font-semibold");
    expect(screen.getByText("Quarterly report").className).not.toContain(
      "font-semibold",
    );
  });

  it("never applies a background tint to an unread row", async () => {
    stubFetch(ONE_ACCOUNT, [
      email({ id: "e1", account_id: "acc-1", is_read: false }),
    ]);
    render(<EmailInbox />);
    await screen.findByText("Quarterly report");

    // The retired treatment was a persistent bg-primary/5 fill on unread
    // rows. A hover-only feedback class (hover:bg-…) is fine — only a base
    // (non-hover) background tint is disallowed.
    const baseTokens = rowFor("Quarterly report")
      .className.split(/\s+/)
      .filter((t) => !t.startsWith("hover:"));
    expect(baseTokens.some((t) => t.startsWith("bg-primary"))).toBe(false);
  });
});
