// PRD #304 — Nookleus Phone. Slice 10 (#314) — Job-page Call compose.
//
// Opened by the Job-page Call button. Picks one of the Job's Contacts and
// places an outbound bridge call with sourceContext { kind: 'job', jobId },
// so smart-attach auto-tags the call to this Job — no chip prompt. There is
// no message body; a call needs only a recipient.

import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComposeCallModal } from "./compose-call-modal";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const contacts = [
  { id: "c-1", name: "Alice Homeowner", phone: "+15551110000" },
  { id: "c-2", name: "Bob Adjuster", phone: "+15552220000" },
];

it("renders nothing when closed", () => {
  const { container } = render(
    <ComposeCallModal
      open={false}
      onClose={() => {}}
      jobId="job-9"
      contacts={contacts}
    />,
  );
  expect(container.firstChild).toBeNull();
});

it("places a Job-tagged call to the chosen contact and closes", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: "call-1", twilio_call_sid: "CA-1", status: "queued" }),
  });
  const onClose = vi.fn();
  const onPlaced = vi.fn();

  render(
    <ComposeCallModal
      open
      onClose={onClose}
      onPlaced={onPlaced}
      jobId="job-9"
      contacts={contacts}
    />,
  );

  // Pick the adjuster, then place the call.
  fireEvent.change(screen.getByLabelText(/recipient/i), {
    target: { value: "c-2" },
  });
  fireEvent.click(screen.getByRole("button", { name: /call/i }));

  await waitFor(() => {
    const post = mockFetch.mock.calls.find(
      ([u, init]) =>
        String(u).endsWith("/api/phone/calls") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      outsideE164: "+15552220000",
      sourceContext: { kind: "job", jobId: "job-9" },
    });
  });

  await waitFor(() => expect(onPlaced).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
});

it("surfaces the server error and stays open when the call is refused", async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 422,
    json: async () => ({
      error: "Add a mobile number to your profile before placing a call.",
    }),
  });
  const onClose = vi.fn();

  render(
    <ComposeCallModal
      open
      onClose={onClose}
      jobId="job-9"
      contacts={contacts}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /call/i }));

  await screen.findByText(/add a mobile number to your profile/i);
  expect(onClose).not.toHaveBeenCalled();
});
