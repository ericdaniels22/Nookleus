import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  UnreadResponsesSection,
  type UnreadResponseThread,
} from "./unread-responses-section";

function makeThread(over: Partial<UnreadResponseThread> = {}): UnreadResponseThread {
  return {
    thread_id: "thread-1",
    job_id: null,
    latest_email_id: "email-1",
    latest_subject: "Re: Roof leak",
    latest_from_name: "Pat Sender",
    latest_from_address: "pat@example.com",
    latest_snippet: "Following up on the estimate.",
    latest_received_at: "2026-05-27T10:00:00Z",
    unread_count: 1,
    ...over,
  };
}

describe("<UnreadResponsesSection>", () => {
  it("renders the stable empty-state copy when total is 0", () => {
    render(<UnreadResponsesSection threads={[]} total={0} />);
    expect(screen.getByText("No unread responses on shared inboxes.")).toBeTruthy();
  });

  it("wraps each preview row in an anchor to /email?id=<latest_email_id>", () => {
    const threads = [
      makeThread({ thread_id: "t-a", latest_email_id: "email-aaa", latest_subject: "Subj A" }),
      makeThread({ thread_id: "t-b", latest_email_id: "email-bbb", latest_subject: "Subj B" }),
    ];
    render(<UnreadResponsesSection threads={threads} total={2} />);

    const aRow = screen.getByText("Subj A").closest("a");
    const bRow = screen.getByText("Subj B").closest("a");
    expect(aRow?.getAttribute("href")).toBe("/email?id=email-aaa");
    expect(bRow?.getAttribute("href")).toBe("/email?id=email-bbb");
  });

  it("renders an `Open inbox` link in the header pointing to /email", () => {
    render(<UnreadResponsesSection threads={[makeThread()]} total={1} />);
    const link = screen.getByRole("link", { name: /open inbox/i });
    expect(link.getAttribute("href")).toBe("/email");
  });

  it("does not render a `+ N more` tail when total ≤ 3", () => {
    const threads = [
      makeThread({ thread_id: "a", latest_email_id: "e-a" }),
      makeThread({ thread_id: "b", latest_email_id: "e-b" }),
      makeThread({ thread_id: "c", latest_email_id: "e-c" }),
    ];
    render(<UnreadResponsesSection threads={threads} total={3} />);
    expect(screen.queryByText(/\+ \d+ more/)).toBeNull();
  });

  it("renders `+ N more` linking to /email when total exceeds the preview cap", () => {
    const threads = [
      makeThread({ thread_id: "a", latest_email_id: "e-a" }),
      makeThread({ thread_id: "b", latest_email_id: "e-b" }),
      makeThread({ thread_id: "c", latest_email_id: "e-c" }),
    ];
    render(<UnreadResponsesSection threads={threads} total={9} />);
    const tail = screen.getByText("+ 6 more");
    const anchor = tail.closest("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/email");
  });

  it("renders up to 3 preview rows plus a count pill of the total", () => {
    const threads = [
      makeThread({ thread_id: "a", latest_email_id: "e-a", latest_subject: "Subj A" }),
      makeThread({ thread_id: "b", latest_email_id: "e-b", latest_subject: "Subj B" }),
      makeThread({ thread_id: "c", latest_email_id: "e-c", latest_subject: "Subj C" }),
    ];
    render(<UnreadResponsesSection threads={threads} total={3} />);

    expect(screen.getByText("Subj A")).toBeTruthy();
    expect(screen.getByText("Subj B")).toBeTruthy();
    expect(screen.getByText("Subj C")).toBeTruthy();

    const pill = screen.getByTestId("unread-responses-count");
    expect(pill.textContent).toContain("3");
  });

  it("does not render a `<N> unread` badge when unread_count is 1", () => {
    const threads = [makeThread({ unread_count: 1 })];
    render(<UnreadResponsesSection threads={threads} total={1} />);
    expect(screen.queryByText(/\d+ unread/i)).toBeNull();
  });

  it("renders a `<N> unread` badge when unread_count > 1", () => {
    const threads = [makeThread({ unread_count: 4 })];
    render(<UnreadResponsesSection threads={threads} total={1} />);
    expect(screen.getByText(/4 unread/i)).toBeTruthy();
  });

  it("shows sender, subject and snippet in each row", () => {
    const threads = [
      makeThread({
        latest_from_name: "Adjuster Alice",
        latest_subject: "Claim 1234 update",
        latest_snippet: "We need photos by Friday.",
      }),
    ];
    render(<UnreadResponsesSection threads={threads} total={1} />);
    expect(screen.getByText("Adjuster Alice")).toBeTruthy();
    expect(screen.getByText("Claim 1234 update")).toBeTruthy();
    expect(screen.getByText("We need photos by Friday.")).toBeTruthy();
  });
});
