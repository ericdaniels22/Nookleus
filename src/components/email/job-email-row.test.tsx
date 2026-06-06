import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { Email } from "@/lib/types";
import { buildQuotedReply } from "./build-quoted-reply";

// Issue #215 — Reply from a Job View email opens the compose modal with the
// original quoted into the draft, byte-identical to the Inbox's quote block.
// We mock ComposeEmailModal at the import boundary so the test can inspect
// the `defaultBody` prop that crosses the launcher → modal boundary; the
// modal's internals aren't under test here.

const composeMock = vi.fn<(props: Record<string, unknown>) => null>(() => null);
vi.mock("@/components/compose-email", () => ({
  default: (props: Record<string, unknown>) => composeMock(props),
}));

// EmailBodyFrame uses ResizeObserver (not in jsdom) and EmailAttachments
// hits /api/email/attachments/*. Neither is the system under test.
vi.mock("@/components/email/email-body-frame", () => ({
  EmailBodyFrame: ({ html }: { html: string }) => <div data-testid="body-frame">{html}</div>,
}));
vi.mock("@/components/email/email-attachments", () => ({
  EmailAttachments: () => null,
}));

import { JobEmailRow } from "./job-email-row";
import ComposeEmailModal from "@/components/compose-email";

function fixtureEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "e1",
    account_id: "a1",
    job_id: "job-1",
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
    snippet: "Hi there.",
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

// Mirrors the Reply-launcher pattern in `job-detail.tsx`. Kept as a thin
// harness so the integration test exercises the real JobEmailRow + the real
// buildQuotedReply through to the real ComposeEmailModal prop boundary.
function Harness({ email }: { email: Email }) {
  const [expanded, setExpanded] = useState(true);
  const [open, setOpen] = useState(false);
  const [defaults, setDefaults] = useState({ to: "", subject: "", body: "", replyToMessageId: "" });
  return (
    <div>
      <JobEmailRow
        email={email}
        isExpanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        onReply={() => {
          const isSent = email.folder === "sent" || email.folder === "drafts";
          const replyTo = isSent ? (email.to_addresses?.[0]?.email || "") : email.from_address;
          const replySubject = email.subject.startsWith("Re:") ? email.subject : "Re: " + email.subject;
          setDefaults({
            to: replyTo,
            subject: replySubject,
            body: buildQuotedReply(email),
            replyToMessageId: email.message_id,
          });
          setOpen(true);
        }}
      />
      <ComposeEmailModal
        open={open}
        onOpenChange={setOpen}
        jobId="job-1"
        defaultTo={defaults.to}
        defaultSubject={defaults.subject}
        defaultBody={defaults.body}
        replyToMessageId={defaults.replyToMessageId || undefined}
        onSent={() => undefined}
      />
    </div>
  );
}

beforeEach(() => {
  composeMock.mockClear();
});

// #216 — CC always when populated; BCC only on sender-side folders
// (sent / drafts) so received emails never leak BCC even if the
// field is set. Originally landed as `src/components/job-detail.test.tsx`
// in PR #218 against the inline EmailRow export; moved here when #215
// extracted EmailRow into JobEmailRow.
describe("JobEmailRow CC/BCC visibility (#216)", () => {
  function renderRow(email: Email) {
    return render(
      <JobEmailRow
        email={email}
        isExpanded={true}
        onToggle={() => undefined}
        onReply={() => undefined}
      />,
    );
  }

  it("shows CC line on a sent email with CC recipients", () => {
    renderRow(fixtureEmail({
      folder: "sent",
      cc_addresses: [{ email: "carol@example.com", name: "Carol" }],
    }));
    expect(screen.getByText(/^CC:/)).toBeDefined();
    expect(screen.getByText(/Carol/)).toBeDefined();
  });

  it("shows CC line on a received email with CC recipients", () => {
    renderRow(fixtureEmail({
      folder: "inbox",
      cc_addresses: [{ email: "dave@example.com", name: "Dave" }],
    }));
    expect(screen.getByText(/^CC:/)).toBeDefined();
    expect(screen.getByText(/Dave/)).toBeDefined();
  });

  it("shows BCC line on a sent email with BCC recipients", () => {
    renderRow(fixtureEmail({
      folder: "sent",
      bcc_addresses: [{ email: "eve@example.com", name: "Eve" }],
    }));
    expect(screen.getByText(/^BCC:/)).toBeDefined();
    expect(screen.getByText(/Eve/)).toBeDefined();
  });

  it("hides BCC line on a received email even when bcc_addresses is populated", () => {
    renderRow(fixtureEmail({
      folder: "inbox",
      bcc_addresses: [{ email: "frank@example.com", name: "Frank" }],
    }));
    expect(screen.queryByText(/^BCC:/)).toBeNull();
    expect(screen.queryByText(/Frank/)).toBeNull();
  });

  it("renders no CC label when cc_addresses is empty", () => {
    renderRow(fixtureEmail({ folder: "sent", cc_addresses: [] }));
    expect(screen.queryByText(/^CC:/)).toBeNull();
  });

  it("renders no BCC label when bcc_addresses is empty on a sent email", () => {
    renderRow(fixtureEmail({ folder: "sent", bcc_addresses: [] }));
    expect(screen.queryByText(/^BCC:/)).toBeNull();
  });
});

describe("Job View Reply integration (#215)", () => {
  it("clicking Reply passes a buildQuotedReply-shaped defaultBody to ComposeEmailModal", () => {
    const email = fixtureEmail();
    render(<Harness email={email} />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    // Find the most recent invocation of the mocked modal — it captures
    // `defaultBody` after the launcher's setState has flushed.
    const lastProps = composeMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
    expect(lastProps).toBeDefined();
    expect(lastProps?.defaultBody).toBe(buildQuotedReply(email));
    expect(lastProps?.defaultBody).toContain("On Mar 15, 2024 at 2:30 PM, Jane Doe &lt;jane@example.com&gt; wrote:");
    expect(lastProps?.defaultBody).toContain("<p>Hi there.</p>");
  });

  it("byte-identical guard: the defaultBody is the exact output of buildQuotedReply(email) — the Inbox's contract", () => {
    const email = fixtureEmail();
    render(<Harness email={email} />);

    fireEvent.click(screen.getByRole("button", { name: /reply/i }));

    const lastProps = composeMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    // The Inbox uses the same helper (post-refactor), so this equality
    // is the byte-identical pin between Job View and Inbox replies.
    expect(lastProps.defaultBody).toBe(buildQuotedReply(email));
  });
});
