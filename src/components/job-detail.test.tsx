import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// #216 — the expanded EmailRow in Job View must mirror the Inbox's
// recipient visibility rules: CC is shown whenever cc_addresses is
// non-empty (both directions), and BCC is shown only on sender-side
// folders (sent / drafts). Received emails never show BCC even if the
// field happens to be populated. These DOM assertions pin the four
// visibility cases so a future EmailRow refactor can't silently drop
// CC/BCC or leak BCC into received-folder views.

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/email/email-body-frame", () => ({
  EmailBodyFrame: () => null,
}));

vi.mock("@/components/email/email-attachments", () => ({
  EmailAttachments: () => null,
}));

import { EmailRow } from "./job-detail";
import type { Email } from "@/lib/types";

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "email-1",
    account_id: "acc-1",
    job_id: "job-1",
    message_id: "<msg-1@example.com>",
    thread_id: null,
    folder: "inbox",
    from_address: "alice@example.com",
    from_name: "Alice",
    to_addresses: [{ email: "bob@example.com", name: "Bob" }],
    cc_addresses: [],
    bcc_addresses: [],
    subject: "Hello",
    body_text: "body",
    body_html: null,
    snippet: "body",
    is_read: true,
    is_starred: false,
    has_attachments: false,
    matched_by: null,
    category: null,
    uid: 1,
    received_at: "2026-05-22T12:00:00Z",
    created_at: "2026-05-22T12:00:00Z",
    ...overrides,
  };
}

function renderRow(email: Email) {
  return render(
    <EmailRow
      email={email}
      isExpanded={true}
      onToggle={() => {}}
      onReply={() => {}}
    />,
  );
}

describe("EmailRow CC/BCC visibility (#216)", () => {
  it("shows CC line on a sent email with CC recipients", () => {
    renderRow(
      makeEmail({
        folder: "sent",
        cc_addresses: [{ email: "carol@example.com", name: "Carol" }],
      }),
    );
    expect(screen.getByText(/^CC:/)).toBeDefined();
    expect(screen.getByText(/Carol/)).toBeDefined();
  });

  it("shows CC line on a received email with CC recipients", () => {
    renderRow(
      makeEmail({
        folder: "inbox",
        cc_addresses: [{ email: "dave@example.com", name: "Dave" }],
      }),
    );
    expect(screen.getByText(/^CC:/)).toBeDefined();
    expect(screen.getByText(/Dave/)).toBeDefined();
  });

  it("shows BCC line on a sent email with BCC recipients", () => {
    renderRow(
      makeEmail({
        folder: "sent",
        bcc_addresses: [{ email: "eve@example.com", name: "Eve" }],
      }),
    );
    expect(screen.getByText(/^BCC:/)).toBeDefined();
    expect(screen.getByText(/Eve/)).toBeDefined();
  });

  it("hides BCC line on a received email even when bcc_addresses is populated", () => {
    renderRow(
      makeEmail({
        folder: "inbox",
        bcc_addresses: [{ email: "frank@example.com", name: "Frank" }],
      }),
    );
    expect(screen.queryByText(/^BCC:/)).toBeNull();
    expect(screen.queryByText(/Frank/)).toBeNull();
  });

  it("renders no CC label when cc_addresses is empty", () => {
    renderRow(makeEmail({ folder: "sent", cc_addresses: [] }));
    expect(screen.queryByText(/^CC:/)).toBeNull();
  });

  it("renders no BCC label when bcc_addresses is empty on a sent email", () => {
    renderRow(makeEmail({ folder: "sent", bcc_addresses: [] }));
    expect(screen.queryByText(/^BCC:/)).toBeNull();
  });
});
