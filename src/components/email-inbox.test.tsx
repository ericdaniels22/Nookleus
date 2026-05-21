import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

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

function stubFetch(accounts: Record<string, unknown>[]) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const spy = vi.fn(async (url: string) => {
    if (url.startsWith("/api/email/accounts")) return json(accounts);
    if (url.startsWith("/api/email/list"))
      return json({ emails: [], total: 0, page: 1, hasMore: false });
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
