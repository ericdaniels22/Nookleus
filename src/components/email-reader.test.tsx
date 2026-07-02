import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// The reading pane routes an email's body to one of two light surfaces: HTML
// mail goes to the sandboxed light content island (EmailBodyFrame, §2.8),
// text-only mail to a plain <pre>. The design-v2 reskin (step 9 / #918)
// restyles the chrome and wraps the thread cards as a deliberate light island,
// so this pins the routing decision so a styling change can't silently drop a
// body or send HTML down the plain-text path.
//
// EmailBodyFrame is mocked to a marker — the island's own isolation/light
// behavior is covered in email/email-body-frame.test.tsx; here we only assert
// which surface the reader picks. No jest-dom matchers (none configured).

vi.mock("@/components/email/email-body-frame", () => ({
  EmailBodyFrame: ({ html }: { html: string }) => (
    <div data-testid="email-body-frame">{html}</div>
  ),
}));
vi.mock("@/components/email/email-attachments", () => ({
  EmailAttachments: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import EmailReader from "./email-reader";

function makeEmail(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    account_id: "acc-1",
    thread_id: null,
    subject: "Hello",
    from_name: "Sender",
    from_address: "sender@example.com",
    to_addresses: [{ email: "me@example.com" }],
    cc_addresses: [],
    received_at: "2026-06-01T10:00:00Z",
    snippet: "snippet",
    is_read: true,
    is_starred: false,
    has_attachments: false,
    attachments: [],
    job: null,
    body_html: null,
    body_text: null,
    ...overrides,
  };
}

function stubFetch(email: Record<string, unknown>) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(`/api/email/${email.id}`) && init?.method !== "PATCH") {
      return json(email);
    }
    return json({ ok: true });
  });
}

function renderReader(props: Partial<React.ComponentProps<typeof EmailReader>> = {}) {
  return render(
    <EmailReader
      emailId="e1"
      onBack={() => {}}
      onReply={() => {}}
      onReplyAll={() => {}}
      onForward={() => {}}
      onStarToggle={() => {}}
      {...props}
    />,
  );
}

describe("EmailReader body routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders HTML mail in the light content island", async () => {
    vi.stubGlobal("fetch", stubFetch(makeEmail({ body_html: "<p>rich body</p>" })));
    renderReader();
    const island = await screen.findByTestId("email-body-frame");
    expect(island.textContent).toContain("<p>rich body</p>");
  });

  it("renders text-only mail in the plain-text fallback, not the island", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch(makeEmail({ body_html: null, body_text: "just plain text" })),
    );
    renderReader();
    await screen.findByText("just plain text");
    expect(screen.queryByTestId("email-body-frame")).toBeNull();
  });
});

// #955 — the reader header spells out the full address the email was delivered
// to, so there's never doubt about which mailbox got it. The receiving address
// is the connected account's own address, keyed by the email's account_id
// (the [id] route does not join the account, so the parent passes a map).
describe("EmailReader receiving address (#955)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the full address the email was delivered to", async () => {
    vi.stubGlobal("fetch", stubFetch(makeEmail({ account_id: "acc-1" })));
    renderReader({
      accountAddressById: new Map([["acc-1", "team@aaadisasterrecovery.com"]]),
    });
    await screen.findByText(/team@aaadisasterrecovery\.com/);
  });

  it("omits the receiving line when the address is unknown", async () => {
    vi.stubGlobal("fetch", stubFetch(makeEmail({ account_id: "acc-1" })));
    renderReader({ accountAddressById: new Map() });
    await screen.findByText("Hello"); // header rendered
    expect(screen.queryByText(/delivered to/i)).toBeNull();
  });
});
