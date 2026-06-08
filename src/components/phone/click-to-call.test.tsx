// PRD #304 — Nookleus Phone. Slice 10 (#314) — generic click-to-call.
//
// `ClickToCall` is the one-line affordance any surface that renders a phone
// number wires up to place an outbound bridge call. Clicking it POSTs to
// /api/phone/calls (which rings the Crew Lead's own cell and bridges to the
// customer); a short status line tells the user their phone is about to
// ring. Unlike `ClickToText`, it is NOT gated on the A2P 10DLC flag — voice
// carries no 10DLC dependency.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClickToCall } from "./click-to-call";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
  vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "true");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ClickToCall", () => {
  it("renders nothing when there is no phone number", () => {
    const { container } = render(<ClickToCall e164={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("posts to /api/phone/calls with the number + sourceContext and shows a ringing hint", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: "call-1",
        twilio_call_sid: "CA-1",
        status: "queued",
      }),
    });

    render(
      <ClickToCall
        e164="+15551234567"
        sourceContext={{ kind: "job", jobId: "job-9" }}
      />,
    );

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
        outsideE164: "+15551234567",
        sourceContext: { kind: "job", jobId: "job-9" },
      });
    });

    // A status line confirms the user's own phone is about to ring.
    await screen.findByText(/ring/i);
  });

  it("defaults sourceContext to a contact-card call when none is given", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "c", twilio_call_sid: "CA", status: "queued" }),
    });

    render(<ClickToCall e164="+15551234567" />);
    fireEvent.click(screen.getByRole("button", { name: /call/i }));

    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u).endsWith("/api/phone/calls") &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.sourceContext).toEqual({ kind: "contact" });
    });
  });

  it("surfaces the server error when the profile-cell gate refuses the call", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error:
          "Add a mobile number to your profile before placing a call — it is the phone we ring first.",
      }),
    });

    render(<ClickToCall e164="+15551234567" />);
    fireEvent.click(screen.getByRole("button", { name: /call/i }));

    await screen.findByText(/add a mobile number to your profile/i);
  });

  it("renders even when the A2P 10DLC SMS flag is off (voice has no 10DLC dependency)", () => {
    vi.stubEnv("NEXT_PUBLIC_PHONE_OUTBOUND_ENABLED", "");
    render(<ClickToCall e164="+15551234567" />);
    expect(screen.getByRole("button", { name: /call/i })).toBeDefined();
  });
});
