// Issue #605 (parent PRD #603, ADR 0015) — Marketing suite: manual review
// request from the Job page.
//
// RTL integration tests for the admin-only Reviews section. AC bullets pinned:
//   - "Request review button visible to admins" (hidden — no fetch — otherwise)
//   - "shows the send history (channel, who it went to, when, by whom)"
//   - "warns before double-asking the same customer, with confirm to proceed"
//   - "every send surfaces in the history after it lands"
//
// The section is a client component; we mock useAuth (the admin gate), sonner
// (toast feedback), and fetch (GET history + POST send). The route and the pure
// channel/message/double-send logic are tested separately — here we pin the
// UI's observable behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  value: {
    loading: false,
    profile: { role: "admin" } as { role: string } | null,
  },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => auth.value,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import { ReviewRequestSection } from "./review-request-section";

type Row = {
  id: string;
  channel: "sms" | "email";
  sent_to: string;
  review_link: string;
  sent_by_user_id: string | null;
  sent_by_name: string | null;
  created_at: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "r1",
    channel: "sms",
    sent_to: "+15125550001",
    review_link: "https://g.page/r/abc/review",
    sent_by_user_id: "u1",
    sent_by_name: "Eric",
    created_at: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

function asAdmin() {
  auth.value = { loading: false, profile: { role: "admin" } };
}
function asNonAdmin() {
  auth.value = { loading: false, profile: { role: "estimator" } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A GET that returns `history`, with no POST handler — the read-only cases.
function stubHistory(history: Row[]) {
  const spy = vi.fn(async () => json(history));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.clearAllMocks();
  asAdmin();
});

describe("ReviewRequestSection — access", () => {
  it("renders nothing — and does not fetch — for a non-admin", () => {
    asNonAdmin();
    const spy = stubHistory([]);

    const { container } = render(<ReviewRequestSection jobId="job-1" />);

    expect(container.querySelector("h3")).toBeNull();
    expect(screen.queryByRole("button", { name: /request review/i })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ReviewRequestSection — history", () => {
  it("shows an empty-state and the Request review button when nothing has been sent", async () => {
    stubHistory([]);

    render(<ReviewRequestSection jobId="job-1" />);

    expect(await screen.findByText("Reviews (0)")).toBeDefined();
    expect(screen.getByText(/no review requests sent/i)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /request review/i }),
    ).toBeDefined();
  });

  it("renders each prior send with its recipient, sender, and channel", async () => {
    stubHistory([
      row({ id: "r1", channel: "sms", sent_to: "+15125550001", sent_by_name: "Eric" }),
      row({
        id: "r2",
        channel: "email",
        sent_to: "homer@example.com",
        sent_by_name: "Marge",
        created_at: "2026-06-02T10:00:00Z",
      }),
    ]);

    render(<ReviewRequestSection jobId="job-1" />);

    expect(await screen.findByText("Reviews (2)")).toBeDefined();
    expect(screen.getByText("+15125550001")).toBeDefined();
    expect(screen.getByText("homer@example.com")).toBeDefined();
    expect(screen.getByText(/Eric/)).toBeDefined();
    expect(screen.getByText(/Marge/)).toBeDefined();
    // Channel is conveyed accessibly, not by icon alone.
    expect(screen.getByText("Sent by text")).toBeDefined();
    expect(screen.getByText("Sent by email")).toBeDefined();
  });
});

describe("ReviewRequestSection — sending", () => {
  it("Request review → POST (unacknowledged) → success toast and the new send surfaces", async () => {
    let getCount = 0;
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return json({ channel: "sms", sentTo: "+15125550001" }, 201);
      }
      getCount += 1;
      // Empty before the send; the new row appears on the post-send refetch.
      return json(getCount === 1 ? [] : [row({ id: "r-new" })]);
    });
    vi.stubGlobal("fetch", spy);

    render(<ReviewRequestSection jobId="job-1" />);

    await screen.findByText("Reviews (0)");
    fireEvent.click(screen.getByRole("button", { name: /request review/i }));

    await waitFor(() => {
      const post = spy.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(post).toBeDefined();
      // No acknowledgement on the first attempt.
      expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({});
    });

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      "Review request sent by text message.",
    );
    expect(await screen.findByText("Reviews (1)")).toBeDefined();
  });

  it("surfaces the route's error message as a toast when the send fails", async () => {
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return json(
          {
            error:
              "No Google review link is available. Connect your Google Business Profile in Settings, then try again.",
          },
          422,
        );
      }
      return json([]);
    });
    vi.stubGlobal("fetch", spy);

    render(<ReviewRequestSection jobId="job-1" />);

    await screen.findByText("Reviews (0)");
    fireEvent.click(screen.getByRole("button", { name: /request review/i }));

    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        expect.stringContaining("No Google review link is available"),
      );
    });
  });
});

describe("ReviewRequestSection — double-send guard", () => {
  it("warns on a 409 then re-POSTs with acknowledged when the admin confirms", async () => {
    let getCount = 0;
    let posts = 0;
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        // First click → already-asked warning; second (confirmed) → sent.
        if (posts === 1) {
          return json(
            {
              error: "already_requested",
              message:
                "This customer has already been asked for a review. Send another request?",
              summary: {
                alreadyRequested: true,
                count: 2,
                last: {
                  channel: "sms",
                  created_at: "2026-06-01T10:00:00Z",
                  sender_name: "Eric",
                },
              },
            },
            409,
          );
        }
        return json({ channel: "email", sentTo: "homer@example.com" }, 201);
      }
      getCount += 1;
      return json(
        getCount <= 1 ? [row()] : [row(), row({ id: "r-2", channel: "email" })],
      );
    });
    vi.stubGlobal("fetch", spy);

    render(<ReviewRequestSection jobId="job-1" />);

    // One prior send exists.
    await screen.findByText("Reviews (1)");
    fireEvent.click(screen.getByRole("button", { name: /request review/i }));

    // The double-send warning surfaces with the prior-send detail; the plain
    // Request-review button is replaced by the confirm affordance.
    expect(await screen.findByText(/already been asked/i)).toBeDefined();
    expect(screen.getByText(/last on/i)).toBeDefined();
    expect(screen.getByText(/by Eric/i)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /request review/i }),
    ).toBeNull();

    // Confirm → the second POST carries acknowledged: true.
    fireEvent.click(screen.getByRole("button", { name: /send anyway/i }));

    await waitFor(() => {
      const confirmed = spy.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(confirmed).toHaveLength(2);
      expect(JSON.parse(String((confirmed[1][1] as RequestInit).body))).toEqual({
        acknowledged: true,
      });
    });

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      "Review request sent by email.",
    );
  });

  it("Cancel dismisses the warning without sending", async () => {
    let posts = 0;
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        return json(
          {
            error: "already_requested",
            message: "already asked",
            summary: { alreadyRequested: true, count: 1, last: null },
          },
          409,
        );
      }
      return json([row()]);
    });
    vi.stubGlobal("fetch", spy);

    render(<ReviewRequestSection jobId="job-1" />);

    await screen.findByText("Reviews (1)");
    fireEvent.click(screen.getByRole("button", { name: /request review/i }));
    await screen.findByText(/already been asked/i);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Warning gone, button back, and no further POST fired.
    await waitFor(() =>
      expect(screen.queryByText(/already been asked/i)).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: /request review/i }),
    ).toBeDefined();
    expect(posts).toBe(1);
  });
});
