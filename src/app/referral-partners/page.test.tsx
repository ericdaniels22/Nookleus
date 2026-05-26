// /referral-partners list-page tests.
//
// The list page already covered its own happy path (#250); this file adds
// the issue-#252 acceptance criterion that "the list page's rows link to
// the Worksheet for that partner". Wired via Next.js <Link>, so the test
// just looks for an anchor whose `href` is `/referral-partners/<id>`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import ReferralPartnersPage from "./page";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockList(partners: unknown[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ referral_partners: partners }),
  } as Response);
}

describe("/referral-partners list page", () => {
  it("renders each partner row as a link to its Call Worksheet", async () => {
    mockList([
      { id: "p-1", company_name: "Acme Plumbing", status: "grey", industry: "Plumbing" },
      { id: "p-2", company_name: "Beta Restoration", status: "green", industry: null },
    ]);

    render(<ReferralPartnersPage />);

    await waitFor(() => {
      expect(screen.getByText("Acme Plumbing")).toBeDefined();
      expect(screen.getByText("Beta Restoration")).toBeDefined();
    });

    const acmeLink = screen.getByText("Acme Plumbing").closest("a");
    expect(acmeLink).not.toBeNull();
    expect(acmeLink?.getAttribute("href")).toBe("/referral-partners/p-1");

    const betaLink = screen.getByText("Beta Restoration").closest("a");
    expect(betaLink?.getAttribute("href")).toBe("/referral-partners/p-2");
  });

  // ── PRD #249 issue #254 AC: list page surfaces denormalized columns ──
  it("surfaces last-called, last-call outcome, and next follow-up on each partner row", async () => {
    mockList([
      {
        id: "p-1",
        company_name: "Acme Plumbing",
        status: "yellow",
        industry: "Plumbing",
        last_called_at: "2026-05-10T11:00:00Z",
        last_call_outcome: "interested",
        next_follow_up_at: "2026-06-15T15:00:00Z",
      },
    ]);

    render(<ReferralPartnersPage />);

    const row = await waitFor(() => {
      const text = screen.getByText("Acme Plumbing");
      return text.closest("a") as HTMLAnchorElement;
    });
    // The three denormalized values are visible somewhere in the row.
    expect(row.textContent).toMatch(/interested/i);
    // Date formatting is locale-dependent — assert the year is present.
    expect(row.textContent).toMatch(/2026/);
    // The "Next follow-up" label is the unambiguous marker that the
    // follow-up date column is being rendered.
    expect(row.textContent).toMatch(/follow[- ]up/i);
  });

  it("renders a row with no call history without crashing", async () => {
    mockList([
      {
        id: "p-1",
        company_name: "Acme Plumbing",
        status: "grey",
        industry: "Plumbing",
        last_called_at: null,
        last_call_outcome: null,
        next_follow_up_at: null,
      },
    ]);

    render(<ReferralPartnersPage />);

    await waitFor(() => {
      expect(screen.getByText("Acme Plumbing")).toBeDefined();
    });
  });
});
