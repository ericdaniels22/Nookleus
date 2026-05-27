// /referral-partners list-page tests.
//
// The list page already covered its own happy path (#250); this file adds
// the issue-#252 acceptance criterion that "the list page's rows link to
// the Worksheet for that partner". Wired via Next.js <Link>, so the test
// just looks for an anchor whose `href` is `/referral-partners/<id>`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import ReferralPartnersPage from "./page";
import { STATUS_ROW_STYLES } from "@/lib/referral-partner-row-styles";

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

  // ── Issue #299: row redesign mirroring the contracts row pattern ──────

  it("tints each row card with the per-Lifecycle-status palette", async () => {
    mockList([
      { id: "p-grey",   company_name: "Grey Co",   status: "grey",   industry: null },
      { id: "p-yellow", company_name: "Yellow Co", status: "yellow", industry: null },
      { id: "p-green",  company_name: "Green Co",  status: "green",  industry: null },
      { id: "p-red",    company_name: "Red Co",    status: "red",    industry: null },
    ]);

    render(<ReferralPartnersPage />);

    await waitFor(() => {
      expect(screen.getByText("Grey Co")).toBeDefined();
    });

    const cases = [
      { name: "Grey Co",   status: "grey"   as const },
      { name: "Yellow Co", status: "yellow" as const },
      { name: "Green Co",  status: "green"  as const },
      { name: "Red Co",    status: "red"    as const },
    ];
    for (const c of cases) {
      const link = screen.getByText(c.name).closest("a");
      expect(link).not.toBeNull();
      const wrapClasses = STATUS_ROW_STYLES[c.status].wrap.split(/\s+/).filter(Boolean);
      for (const cls of wrapClasses) {
        expect(link?.className).toContain(cls);
      }
    }
  });

  it("renders the status label as colored uppercase text inside the row, not as a left-side pill", async () => {
    mockList([
      { id: "p-1", company_name: "Acme Plumbing", status: "green", industry: "Plumbing" },
    ]);

    render(<ReferralPartnersPage />);

    // The row link wraps the partner name; the row's status label is the
    // "Active" string inside that link (not the filter chip at the top).
    const row = (await waitFor(() => {
      const text = screen.getByText("Acme Plumbing");
      return text.closest("a");
    })) as HTMLAnchorElement;
    const candidates = Array.from(row.querySelectorAll("span")).filter(
      (el) => el.textContent === "Active",
    );
    expect(candidates).toHaveLength(1);
    const label = candidates[0]!;
    expect(label.className).toContain("uppercase");
    expect(label.className).toContain("text-[#5DCAA5]");
    // The old pill chip class must be gone from inside the row.
    expect(row.innerHTML).not.toContain("rounded-full");
  });

  it("shows the formatted office phone on the industry line", async () => {
    mockList([
      {
        id: "p-1",
        company_name: "Acme Plumbing",
        status: "yellow",
        industry: "Plumbing",
        office_phone: "5125551234",
      },
    ]);

    render(<ReferralPartnersPage />);

    const row = await waitFor(() => {
      const text = screen.getByText("Acme Plumbing");
      return text.closest("a") as HTMLAnchorElement;
    });
    expect(row.textContent).toContain("Plumbing");
    expect(row.textContent).toContain("(512) 555-1234");
  });

  it("renders notes truncated to one line with the full text in the title attribute", async () => {
    const fullNote =
      "Spoke with Sarah at the front desk; she said the owner Dave handles all referrals and prefers Thursday calls after 2pm.";
    mockList([
      {
        id: "p-1",
        company_name: "Acme Plumbing",
        status: "green",
        industry: "Plumbing",
        notes: fullNote,
      },
    ]);

    render(<ReferralPartnersPage />);

    const notesEl = await screen.findByTestId("referral-partner-notes-p-1");
    expect(notesEl.textContent).toContain(fullNote);
    expect(notesEl.getAttribute("title")).toBe(fullNote);
    expect(notesEl.className).toMatch(/truncate/);
  });

  it("omits the office phone and notes lines gracefully when both are missing", async () => {
    mockList([
      {
        id: "p-1",
        company_name: "Acme Plumbing",
        status: "grey",
        industry: "Plumbing",
        office_phone: null,
        notes: null,
      },
    ]);

    render(<ReferralPartnersPage />);

    await waitFor(() => {
      expect(screen.getByText("Acme Plumbing")).toBeDefined();
    });
    expect(screen.queryByTestId("referral-partner-notes-p-1")).toBeNull();
  });

  it("uses the shared <Button> component for the Add Target CTA (no raw btn-primary classes)", async () => {
    mockList([]);
    render(<ReferralPartnersPage />);

    const btn = await screen.findByRole("button", { name: /add target/i });
    // Shared Button is Base-UI-backed; its root carries data-slot="button"
    // (same signal PR #284 used to verify the swap from raw btn classes).
    expect(btn.getAttribute("data-slot")).toBe("button");
    expect(btn.className).not.toContain("btn-primary");
  });
});
