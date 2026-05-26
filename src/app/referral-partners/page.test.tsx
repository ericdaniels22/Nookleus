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
});
