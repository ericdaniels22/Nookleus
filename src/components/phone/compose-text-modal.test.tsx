// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Text compose.
//
// The Job-page Text button opens this modal with one of the Job's Contacts
// pre-filled. Sending posts to /api/phone/messages with
// sourceContext: { kind: 'job', jobId } so smart-attach auto-tags the
// outbound to this Job — there is NO tagging-chip prompt in this path
// (the tag is definite). AC bullets pinned here:
//   - "Text button opens compose with one of the Job's Contacts pre-filled"
//   - "outbound text auto-tagged (job_tag set, no chip prompt)"

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComposeTextModal } from "./compose-text-modal";

const homeowner = { id: "c1", name: "Homer Owner", phone: "+15125550001" };
const adjuster = { id: "c2", name: "Adjuster Joe", phone: "+15125550002" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSendOk() {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: "sent-1", status: "queued" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("ComposeTextModal — recipient pre-fill", () => {
  it("opens with the first (primary) contact pre-filled as the recipient", () => {
    render(
      <ComposeTextModal
        open
        onClose={() => {}}
        jobId="job-1"
        contacts={[homeowner]}
      />,
    );
    expect(screen.getByText("Homer Owner")).toBeDefined();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ComposeTextModal
        open={false}
        onClose={() => {}}
        jobId="job-1"
        contacts={[homeowner]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ComposeTextModal — multiple contacts", () => {
  it("shows a recipient dropdown listing every contact, defaulting to the first", () => {
    render(
      <ComposeTextModal
        open
        onClose={() => {}}
        jobId="job-1"
        contacts={[homeowner, adjuster]}
      />,
    );
    const select = screen.getByLabelText(/recipient/i) as HTMLSelectElement;
    expect(select.value).toBe("c1");
    expect(screen.getByRole("option", { name: "Homer Owner" })).toBeDefined();
    expect(screen.getByRole("option", { name: "Adjuster Joe" })).toBeDefined();
  });
});

describe("ComposeTextModal — no tagging prompt", () => {
  it("never renders the smart-attach tagging chips (the Job tag is definite here)", () => {
    render(
      <ComposeTextModal
        open
        onClose={() => {}}
        jobId="job-1"
        contacts={[homeowner, adjuster]}
      />,
    );
    expect(screen.queryByText(/tag to/i)).toBeNull();
    expect(screen.queryByText(/re-tag/i)).toBeNull();
  });
});

describe("ComposeTextModal — send", () => {
  it("posts to /api/phone/messages with the recipient and sourceContext {kind:'job',jobId}, then fires onSent + onClose", async () => {
    const spy = stubSendOk();
    const onSent = vi.fn();
    const onClose = vi.fn();

    render(
      <ComposeTextModal
        open
        onClose={onClose}
        jobId="job-1"
        contacts={[homeowner]}
        onSent={onSent}
      />,
    );

    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "On our way" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/phone/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      outsideE164: "+15125550001",
      body: "On our way",
      sourceContext: { kind: "job", jobId: "job-1" },
    });

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("does not send an empty message", () => {
    const spy = stubSendOk();
    render(
      <ComposeTextModal
        open
        onClose={() => {}}
        jobId="job-1"
        contacts={[homeowner]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(spy).not.toHaveBeenCalled();
  });
});
