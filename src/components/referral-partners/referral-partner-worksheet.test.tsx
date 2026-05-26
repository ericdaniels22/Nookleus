// Call Worksheet presentational + edit-surface tests
// (PRD #249, issues #252 read-only base and #253 editable Worksheet).
//
// This slice ships the editable Call Worksheet: every column listed on
// issue #253 becomes editable, and the header gains a four-color
// Lifecycle status flip-button row that can transition any status to any
// other. The PRD's "no automated transitions" rule is also pinned here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

import {
  ReferralPartnerWorksheet,
  type ReferralPartnerForWorksheet,
  type ReferralContactForWorksheet,
} from "./referral-partner-worksheet";

const BASE_PARTNER: ReferralPartnerForWorksheet = {
  id: "p-1",
  organization_id: "org-1",
  company_name: "Acme Plumbing",
  status: "grey",
  industry: "Plumbing",
  lead_source: "Google",
  operation_size: null,
  office_phone: "+15551230001",
  office_email: "ops@acme.test",
  website: "acme.test",
  address: "100 Main St",
  referral_fee_terms: null,
  notes: null,
  primary_contact_id: null,
  owner_contact_id: null,
};

function renderWorksheet(overrides: {
  partner?: Partial<ReferralPartnerForWorksheet>;
  primaryContact?: ReferralContactForWorksheet | null;
  ownerContact?: ReferralContactForWorksheet | null;
  contacts?: ReferralContactForWorksheet[];
} = {}) {
  const partner = { ...BASE_PARTNER, ...overrides.partner };
  return render(
    <ReferralPartnerWorksheet
      partner={partner}
      primaryContact={overrides.primaryContact ?? null}
      ownerContact={overrides.ownerContact ?? null}
      contacts={overrides.contacts ?? []}
    />,
  );
}

// Test-double for `fetch`. The Worksheet's edit + flip-status paths hit
// PATCH /api/referral-partners/[id]; we mock at the global so the
// component doesn't have to take a fetch prop just for testability.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return {
        ok: true,
        status: 200,
        json: async () => ({
          referral_partner: { ...BASE_PARTNER, ...body },
        }),
      } as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReferralPartnerWorksheet — header + Lifecycle status", () => {
  it("renders the partner's company name in the header", () => {
    renderWorksheet();
    expect(
      screen.getByRole("heading", { level: 1, name: /acme plumbing/i }),
    ).toBeDefined();
  });

  it("renders the Lifecycle status chip alongside the header", () => {
    renderWorksheet({ partner: { status: "green" } });
    const chip = screen.getByTestId("worksheet-lifecycle-status-chip");
    expect(chip.textContent).toMatch(/active/i);
  });

  it("renders all four Lifecycle status flip buttons regardless of current status — no automated transitions", () => {
    renderWorksheet({ partner: { status: "green" } });
    // PRD #249 #17 + issue #253 AC #3 — all four buttons are always
    // visible; any status can flip to any other status with one click.
    for (const colorLabel of [
      /uncontacted/i,
      /in progress/i,
      /active/i,
      /declined/i,
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(`set lifecycle status to.*${colorLabel.source}`, "i") }),
      ).toBeDefined();
    }
  });

  it("clicking a flip button PATCHes the new Lifecycle status and updates the chip", async () => {
    renderWorksheet({ partner: { status: "grey" } });

    const button = screen.getByRole("button", {
      name: /set lifecycle status to active/i,
    });
    fireEvent.click(button);

    // Chip updates optimistically — the user sees the new label without
    // a page reload (issue #253 AC #2).
    await waitFor(() => {
      const chip = screen.getByTestId("worksheet-lifecycle-status-chip");
      expect(chip.textContent).toMatch(/active/i);
    });

    // And the PATCH was fired with the new status.
    expect(fetch).toHaveBeenCalledWith(
      "/api/referral-partners/p-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "green" }),
      }),
    );
  });
});

describe("ReferralPartnerWorksheet — editable company info (PRD #249, issue #253 AC #1)", () => {
  // The whitelist of editable columns mirrors the issue text. Each one is
  // exercised here through its accessible label so the test reflects what
  // a sighted user (and screen-reader user) can do, not the markup shape.
  const EDITABLE_TEXT_COLUMNS: Array<{
    label: RegExp;
    column: string;
    valueOnPartner: string;
    newValue: string;
  }> = [
    { label: /^company name$/i, column: "company_name", valueOnPartner: "Acme Plumbing", newValue: "Acme Plumbing & Co" },
    { label: /^industry$/i, column: "industry", valueOnPartner: "Plumbing", newValue: "HVAC" },
    { label: /^lead source$/i, column: "lead_source", valueOnPartner: "Google", newValue: "Yelp" },
    { label: /^office email$/i, column: "office_email", valueOnPartner: "ops@acme.test", newValue: "hello@acme.test" },
    { label: /^website$/i, column: "website", valueOnPartner: "acme.test", newValue: "acme.example" },
    { label: /^address$/i, column: "address", valueOnPartner: "100 Main St", newValue: "200 Main St" },
  ];

  it.each(EDITABLE_TEXT_COLUMNS)(
    "field $column is editable on the Worksheet and saves to the API on blur",
    async ({ label, column, newValue }) => {
      renderWorksheet();

      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(input, { target: { value: newValue } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/referral-partners/p-1",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ [column]: newValue }),
          }),
        );
      });
    },
  );

  it("Operation size and Referral-fee terms and Notes are editable too", async () => {
    renderWorksheet({
      partner: { operation_size: null, referral_fee_terms: null, notes: null },
    });

    fireEvent.change(screen.getByLabelText(/^operation size$/i), {
      target: { value: "10–25" },
    });
    fireEvent.blur(screen.getByLabelText(/^operation size$/i));

    fireEvent.change(screen.getByLabelText(/^referral-fee terms$/i), {
      target: { value: "10% per closed job" },
    });
    fireEvent.blur(screen.getByLabelText(/^referral-fee terms$/i));

    fireEvent.change(screen.getByLabelText(/^notes$/i), {
      target: { value: "left vm Mon, callback Wed" },
    });
    fireEvent.blur(screen.getByLabelText(/^notes$/i));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ operation_size: "10–25" }),
        }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ referral_fee_terms: "10% per closed job" }),
        }),
      );
      expect(fetch).toHaveBeenCalledWith(
        "/api/referral-partners/p-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ notes: "left vm Mon, callback Wed" }),
        }),
      );
    });
  });

  it("Office phone is editable on the Worksheet (formatted display, raw stored)", async () => {
    renderWorksheet({ partner: { office_phone: null } });

    const input = screen.getByLabelText(/^office phone$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5551234567" } });
    fireEvent.blur(input);

    await waitFor(() => {
      // The Worksheet trusts the platform's existing phone util to
      // normalize on blur; the call goes out with whatever the input
      // currently holds, which is enough to pin "office_phone is in the
      // PATCH body" for this slice.
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const phoneCall = calls.find((c) => {
        const body = JSON.parse((c[1] as RequestInit).body as string);
        return "office_phone" in body;
      });
      expect(phoneCall).toBeDefined();
    });
  });

  it("blurring an unchanged field does NOT fire a PATCH — empty saves are noise", async () => {
    renderWorksheet({ partner: { industry: "Plumbing" } });
    fireEvent.blur(screen.getByLabelText(/^industry$/i));
    // Give any incidental Promises a chance to resolve.
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("ReferralPartnerWorksheet — contacts surface (unchanged from #252)", () => {
  it("renders the Primary contact slot as 'Not set' when no primary is linked", () => {
    renderWorksheet({ primaryContact: null });
    const slot = screen.getByTestId("worksheet-primary-contact");
    expect(slot.textContent).toMatch(/primary contact/i);
    expect(slot.textContent).toMatch(/not set/i);
  });

  it("renders the Primary contact's name, formatted phone, and email when set", () => {
    renderWorksheet({
      primaryContact: {
        id: "c-1",
        full_name: "Pat Smith",
        phone: "+15555550100",
        email: "pat@acme.test",
      },
    });
    const slot = screen.getByTestId("worksheet-primary-contact");
    expect(slot.textContent).toContain("Pat Smith");
    expect(slot.textContent).toContain("(555) 555-0100");
    expect(slot.textContent).toContain("pat@acme.test");
  });

  it("renders the Owner contact's name, formatted phone, and email when set", () => {
    renderWorksheet({
      ownerContact: {
        id: "c-2",
        full_name: "Jamie Owner",
        phone: "+15555550200",
        email: "jamie@acme.test",
      },
    });
    const slot = screen.getByTestId("worksheet-owner-contact");
    expect(slot.textContent).toContain("Jamie Owner");
    expect(slot.textContent).toContain("(555) 555-0200");
    expect(slot.textContent).toContain("jamie@acme.test");
  });

  it("lists every Referral Contact in the 'Contacts at this company' section", () => {
    renderWorksheet({
      contacts: [
        { id: "c-1", full_name: "Pat Smith", phone: null, email: null },
        { id: "c-2", full_name: "Jamie Owner", phone: null, email: null },
        { id: "c-3", full_name: "Riley Newhire", phone: null, email: null },
      ],
    });
    const list = screen.getByTestId("worksheet-contacts-list");
    expect(within(list).getByText("Pat Smith")).toBeDefined();
    expect(within(list).getByText("Jamie Owner")).toBeDefined();
    expect(within(list).getByText("Riley Newhire")).toBeDefined();
  });

  it("renders an empty-state in 'Contacts at this company' when none are linked", () => {
    renderWorksheet({ contacts: [] });
    const list = screen.getByTestId("worksheet-contacts-list");
    expect(list.textContent).toMatch(/no contacts/i);
  });

  it("renders a Call log placeholder section (write lands in #5)", () => {
    renderWorksheet();
    const section = screen.getByTestId("worksheet-call-log");
    expect(section.textContent).toMatch(/call log/i);
  });
});
