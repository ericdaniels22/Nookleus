import { describe, expect, it } from "vitest";
import type { Email } from "@/lib/types";
import { buildQuotedReply } from "./build-quoted-reply";

// Local-time (no Z) so the test is timezone-stable: every CI runner reads
// "2024-03-15T14:30:00" as 2:30 PM local, and date-fns formats it the same.
function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "e1",
    account_id: "a1",
    job_id: null,
    message_id: "m1@x",
    thread_id: null,
    folder: "inbox",
    from_address: "jane@example.com",
    from_name: "Jane Doe",
    to_addresses: [],
    cc_addresses: [],
    bcc_addresses: [],
    subject: "Hello",
    body_text: null,
    body_html: null,
    snippet: null,
    is_read: true,
    is_starred: false,
    has_attachments: false,
    matched_by: null,
    category: null,
    uid: null,
    received_at: "2024-03-15T14:30:00",
    created_at: "2024-03-15T14:30:00",
    ...overrides,
  };
}

describe("buildQuotedReply", () => {
  it("formats received_at as 'MMM d, yyyy at h:mm a' in the header line", () => {
    const html = buildQuotedReply(makeEmail());
    expect(html).toContain("Mar 15, 2024 at 2:30 PM");
  });

  it("renders the sender as 'from_name <from_address>' (HTML-escaped) when from_name is present", () => {
    const html = buildQuotedReply(makeEmail({ from_name: "Jane Doe", from_address: "jane@example.com" }));
    expect(html).toContain("Jane Doe &lt;jane@example.com&gt; wrote:");
  });

  it("renders the sender as from_address alone when from_name is null", () => {
    const html = buildQuotedReply(makeEmail({ from_name: null, from_address: "anon@example.com" }));
    expect(html).toContain("anon@example.com wrote:");
    expect(html).not.toContain("null");
    expect(html).not.toContain("&lt;anon@example.com&gt;");
  });

  it("uses body_html verbatim when present", () => {
    const html = buildQuotedReply(makeEmail({
      body_html: `<p>Hi <strong>Jane</strong>,</p><p>See attached.</p>`,
      body_text: "anything else",
    }));
    expect(html).toContain(`<p>Hi <strong>Jane</strong>,</p><p>See attached.</p>`);
  });

  it("wraps body_text in <p> with <br> for newlines when body_html is absent", () => {
    const html = buildQuotedReply(makeEmail({
      body_html: null,
      body_text: "line one\nline two\nline three",
    }));
    expect(html).toContain("<p>line one<br>line two<br>line three</p>");
  });

  it("still produces the header line for a subject-only email with no body", () => {
    const html = buildQuotedReply(makeEmail({
      from_name: "Jane Doe",
      from_address: "jane@example.com",
      body_html: null,
      body_text: null,
    }));
    expect(html).toContain("On Mar 15, 2024 at 2:30 PM, Jane Doe &lt;jane@example.com&gt; wrote:");
  });

  // Byte-identical pin (issue #215 AC: "Quote block produced from Job View is
  // byte-identical to one produced from the Inbox for the same Email"). If you
  // change the quote template, change this expectation in lockstep.
  it("produces a byte-identical quote block matching the Inbox's prior inline format", () => {
    const html = buildQuotedReply(makeEmail({
      from_name: "Jane Doe",
      from_address: "jane@example.com",
      body_html: `<p>Hi there.</p>`,
    }));
    expect(html).toBe(
      `<br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">
      <p style="margin: 0 0 8px; font-size: 12px;">On Mar 15, 2024 at 2:30 PM, Jane Doe &lt;jane@example.com&gt; wrote:</p>
      <p>Hi there.</p>
    </div>`,
    );
  });
});
