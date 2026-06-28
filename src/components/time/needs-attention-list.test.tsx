// src/components/time/needs-attention-list.test.tsx — the lead's "needs
// attention" list (#706, AC5/AC4/AC6).
//
// An Open session past ~12h (the forgotten clock-out) lands here, amber, for the
// lead. The list is the ENTRY POINT to a Correction. It is gated on
// manage_timesheets (AC6): a crew member never sees it — and never even fetches
// it. Hand-entered sessions are marked here too (AC4).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const auth = vi.hoisted(() => ({
  value: {
    loading: false,
    hasPermission: (_k: string) => false as boolean,
  },
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

import { NeedsAttentionList } from "./needs-attention-list";

function asLead() {
  auth.value = { loading: false, hasPermission: (k: string) => k === "manage_timesheets" };
}
function asCrew() {
  auth.value = { loading: false, hasPermission: () => false };
}

type Row = {
  sessionId: string;
  jobId: string;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  capture: "live" | "hand";
  workerName: string | null;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    sessionId: "sess-1",
    jobId: "job-1",
    userId: "worker-a",
    startedAt: "2026-07-01T12:00:00.000Z",
    endedAt: null,
    capture: "live",
    workerName: "Ada Crew",
    ...overrides,
  };
}

// Stub fetch: the needs-attention GET returns the given rows + Org timeZone.
function stubList(rows: Row[], timeZone = "America/Chicago") {
  const spy = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/time/sessions/needs-attention")) {
      return new Response(JSON.stringify({ sessions: rows, timeZone }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NeedsAttentionList — manage_timesheets gate (#706, AC6)", () => {
  it("renders nothing — and does not even fetch — for a crew member", () => {
    asCrew();
    const spy = stubList([row()]);

    const { container } = render(<NeedsAttentionList jobId="job-1" />);

    expect(container.firstChild).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("NeedsAttentionList — the list (#706, AC5/AC4)", () => {
  it("lists each over-12h Open session by worker, marking hand-entered ones", async () => {
    asLead();
    stubList([
      row({ sessionId: "live-1", userId: "worker-a", workerName: "Ada Crew", capture: "live" }),
      row({ sessionId: "hand-1", userId: "worker-b", workerName: "Bo Lead", capture: "hand" }),
    ]);

    render(<NeedsAttentionList jobId="job-1" />);

    // Both workers surface…
    expect(await screen.findByText("Ada Crew")).toBeDefined();
    expect(screen.getByText("Bo Lead")).toBeDefined();
    // …and the hand-entered one carries the canonical marker (AC4).
    expect(screen.getByText("Hand-entered")).toBeDefined();
  });

  it("shows an all-clear empty state when nothing needs attention", async () => {
    asLead();
    stubList([]);

    render(<NeedsAttentionList jobId="job-1" />);

    expect(await screen.findByText(/nothing needs attention/i)).toBeDefined();
  });
});

describe("NeedsAttentionList — entry point to a Correction (#706, AC5/AC1)", () => {
  it("opens the Correction form for a row and drops the session from the list once corrected", async () => {
    asLead();

    // First needs-attention GET returns the forgotten session; after the
    // Correction PATCH succeeds, the refetch returns an empty list.
    let listCalls = 0;
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (String(url).startsWith("/api/time/sessions/needs-attention")) {
        listCalls += 1;
        const rows =
          listCalls === 1
            ? [row({ sessionId: "sess-1", workerName: "Ada Crew", startedAt: "2026-07-01T12:00:00.000Z" })]
            : [];
        return new Response(JSON.stringify({ sessions: rows, timeZone: "America/Chicago" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url) === "/api/time/sessions/sess-1" && method === "PATCH") {
        return new Response(JSON.stringify({ corrected: true, sessionId: "sess-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", spy);

    render(<NeedsAttentionList jobId="job-1" />);

    // Open the Correction for Ada's forgotten session — the form appears inline.
    fireEvent.click(await screen.findByRole("button", { name: /correct/i }));
    const endIn = await screen.findByLabelText(/clock.?out/i);

    // The lead types the real clock-out and saves.
    fireEvent.change(endIn, { target: { value: "2026-07-01T18:30" } });
    fireEvent.click(screen.getByRole("button", { name: /save correction/i }));

    // The PATCH carried the Org-anchored instant…
    await waitFor(() => {
      const patch = spy.mock.calls.find(
        ([u, i]) => String(u) === "/api/time/sessions/sess-1" && (i as RequestInit)?.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({
        endedAt: "2026-07-01T23:30:00.000Z",
      });
    });

    // …and after the refetch the corrected session is gone from the list.
    await waitFor(() => expect(screen.queryByText("Ada Crew")).toBeNull());
    expect(screen.getByText(/nothing needs attention/i)).toBeDefined();
  });
});
