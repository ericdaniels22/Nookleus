import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

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

function renderReader() {
  return render(
    <EmailReader
      emailId="e1"
      onBack={() => {}}
      onReply={() => {}}
      onReplyAll={() => {}}
      onForward={() => {}}
      onStarToggle={() => {}}
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
