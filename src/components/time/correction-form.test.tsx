// src/components/time/correction-form.test.tsx — the Correction form (#706, AC1).
//
// A lead/admin opens a recorded Time session and TYPES the real clock-in/out.
// The app NEVER pre-fills, suggests, rounds, or fabricates a time (ADR 0019):
// the inputs start empty and the lead types a civil wall-clock, which the form
// anchors in the ONE Organization timezone (ADR 0020) before PATCHing the
// session. A bad span is rejected server-side and surfaced here; a good save
// refetches and closes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CorrectionForm } from "./correction-form";

type Session = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  workerName?: string | null;
  capture?: "live" | "hand";
};

function aSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "sess-1",
    // 5:00 PM CDT on Jul 1 (America/Chicago is UTC-5 in summer).
    startedAt: "2026-07-01T22:00:00.000Z",
    endedAt: null,
    workerName: "Ada Crew",
    capture: "live",
    ...overrides,
  };
}

function stubFetch(impl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(
    impl ??
      (async () =>
        new Response(JSON.stringify({ corrected: true, sessionId: "sess-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CorrectionForm — never pre-fills (#706, AC1 / ADR 0019)", () => {
  it("shows whose session it is but leaves the time inputs empty for the lead to type", () => {
    stubFetch();
    render(
      <CorrectionForm
        session={aSession()}
        timeZone="America/Chicago"
        onCorrected={vi.fn()}
      />,
    );

    // It names the worker the Correction is for.
    expect(screen.getByText(/Ada Crew/)).toBeDefined();

    // The integrity guarantee: NOTHING is suggested. Both fields are blank —
    // the lead must type the real clock-in/out, never accept a pre-fill.
    const startIn = screen.getByLabelText(/clock.?in/i) as HTMLInputElement;
    const endIn = screen.getByLabelText(/clock.?out/i) as HTMLInputElement;
    expect(startIn.value).toBe("");
    expect(endIn.value).toBe("");
  });
});

describe("CorrectionForm — anchors the typed time in the Org zone (#706, ADR 0020)", () => {
  it("PATCHes only the field the lead typed, as a UTC instant anchored in the Org zone, then refetches", async () => {
    const spy = stubFetch();
    const onCorrected = vi.fn();
    render(
      <CorrectionForm
        session={aSession()}
        timeZone="America/Chicago"
        onCorrected={onCorrected}
      />,
    );

    // The lead types only the real clock-out (6:30 PM Central) — clock-in left
    // blank means "unchanged".
    fireEvent.change(screen.getByLabelText(/clock.?out/i), {
      target: { value: "2026-07-01T18:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save correction/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/time/sessions/sess-1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body));
    // 6:30 PM CDT (UTC-5) → 23:30 UTC. The clock-in is absent (unchanged).
    expect(body).toEqual({ endedAt: "2026-07-01T23:30:00.000Z" });

    await waitFor(() => expect(onCorrected).toHaveBeenCalled());
  });

  it("refuses an empty save — no time typed means nothing to correct, and never posts", async () => {
    const spy = stubFetch();
    const onCorrected = vi.fn();
    render(
      <CorrectionForm
        session={aSession()}
        timeZone="America/Chicago"
        onCorrected={onCorrected}
      />,
    );

    // Save with both fields blank.
    fireEvent.click(screen.getByRole("button", { name: /save correction/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    // ADR 0019 — no fabrication, not even a no-op write; and nothing "corrected".
    expect(spy).not.toHaveBeenCalled();
    expect(onCorrected).not.toHaveBeenCalled();
  });

  it("surfaces a server span rejection and stays open (does not refetch)", async () => {
    const spy = stubFetch(async () =>
      new Response(JSON.stringify({ error: "clock-out must be after clock-in" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const onCorrected = vi.fn();
    render(
      <CorrectionForm
        session={aSession()}
        timeZone="America/Chicago"
        onCorrected={onCorrected}
      />,
    );

    fireEvent.change(screen.getByLabelText(/clock.?out/i), {
      target: { value: "2026-06-30T09:00" }, // before the recorded clock-in
    });
    fireEvent.click(screen.getByRole("button", { name: /save correction/i }));

    // The lead sees exactly why the server refused it…
    expect(
      await screen.findByText(/clock-out must be after clock-in/i),
    ).toBeDefined();
    // …and nothing was treated as corrected.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onCorrected).not.toHaveBeenCalled();
  });
});
