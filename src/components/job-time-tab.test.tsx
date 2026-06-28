// AC4 (#706) — hand-entered/corrected sessions render a visible marker wherever
// sessions are listed. The Job time tab is one such surface: a session whose
// capture marker is 'hand' shows a "Hand-entered" badge; a live-clocked session
// shows none, so a reviewer can tell typed from live-clocked at a glance.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

import JobTimeTab from "@/components/job-time-tab";

// The worker is not currently on the clock here; time tracking is enabled.
vi.mock("@/lib/on-the-clock-context", () => ({
  useOnTheClock: () => ({ active: null, canTrackTime: true }),
}));

// The clock-in confirmation modal is irrelevant to the marker; stub it inert.
vi.mock("@/components/time/clock-in-confirmation", () => ({ default: () => null }));

// The Time tab now hosts the lead's needs-attention surface, which gates on
// manage_timesheets. Default the caller to a crew member (no permission) so the
// marker tests below are unaffected; the wiring tests opt into a lead.
const auth = vi.hoisted(() => ({
  value: { loading: false, hasPermission: (_k: string) => false as boolean },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

function stubSessions(sessions: Record<string, unknown>[]) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ sessions }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const JOB = { id: "job-1", property_address: "123 Main", job_number: "J-1" };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to a crew member each test; lead tests opt in explicitly.
  auth.value = { loading: false, hasPermission: () => false };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JobTimeTab — hand-entered marker (#706)", () => {
  it("marks a hand-entered session and leaves a live-clocked one unmarked", async () => {
    stubSessions([
      { sessionId: "s-hand", jobId: "job-1", startedAt: "2026-06-19T09:00:00Z", endedAt: "2026-06-19T17:00:00Z", capture: "hand" },
      { sessionId: "s-live", jobId: "job-1", startedAt: "2026-06-18T09:00:00Z", endedAt: "2026-06-18T12:00:00Z", capture: "live" },
    ]);

    render(<JobTimeTab job={JOB} />);

    // Exactly one marker renders — for the hand-entered session, not the live one.
    const markers = await screen.findAllByText("Hand-entered");
    expect(markers).toHaveLength(1);
  });

  it("shows no marker when every session is live-clocked", async () => {
    stubSessions([
      { sessionId: "s-live", jobId: "job-1", startedAt: "2026-06-18T09:00:00Z", endedAt: "2026-06-18T12:00:00Z", capture: "live" },
    ]);

    render(<JobTimeTab job={JOB} />);

    // The list has rendered (the duration shows) but carries no marker.
    await screen.findByText(/–/);
    expect(screen.queryByText("Hand-entered")).toBeNull();
  });
});

// AC5 (#706) — the Job time surface is where a lead reaches the needs-attention
// list (the over-12h forgotten clock-outs), gated on manage_timesheets. A crew
// member tracking their own hours never sees it.
describe("JobTimeTab — needs-attention surface (#706, AC5/AC6)", () => {
  it("surfaces the needs-attention list for a manage_timesheets lead", async () => {
    auth.value = { loading: false, hasPermission: (k: string) => k === "manage_timesheets" };
    const spy = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/time/sessions/needs-attention")) {
        return new Response(
          JSON.stringify({
            sessions: [
              { sessionId: "na-1", jobId: "job-1", userId: "w-a", startedAt: "2026-06-19T00:00:00Z", endedAt: null, capture: "live", workerName: "Ada Crew" },
            ],
            timeZone: "America/Chicago",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // The own-hours read.
      return new Response(JSON.stringify({ sessions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    render(<JobTimeTab job={JOB} />);

    expect(await screen.findByText(/needs attention/i)).toBeDefined();
    expect(await screen.findByText("Ada Crew")).toBeDefined();
  });

  it("hides the needs-attention surface from a crew member", async () => {
    stubSessions([]); // crew (default); list is gated off, so it never fetches it
    render(<JobTimeTab job={JOB} />);

    await screen.findByText(/no recorded hours yet/i);
    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });
});
