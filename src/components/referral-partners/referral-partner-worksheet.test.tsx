// Read-only Call Worksheet presentational tests (PRD #249, issue #252).
//
// This slice ships a read-only Call Worksheet — header + company info, Primary
// contact / Owner contact slots, "Contacts at this company" list, and a Call
// log placeholder. Edit affordances, Lifecycle flip buttons, "Log a call", and
// "+ Add contact" all explicitly land in later slices (#4, #5, #6); the tests
// below pin that none of those appear here.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

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

describe("ReferralPartnerWorksheet (read-only)", () => {
  it("renders the partner's company name in the header", () => {
    renderWorksheet();
    expect(
      screen.getByRole("heading", { level: 1, name: /acme plumbing/i }),
    ).toBeDefined();
  });

  it("renders the Lifecycle status chip alongside the header", () => {
    renderWorksheet({ partner: { status: "green" } });
    const chip = screen.getByTestId("worksheet-lifecycle-status-chip");
    // The chip surfaces a readable label for each Lifecycle status. "Active"
    // is the label for `green` in the existing list page; we re-use it here.
    expect(chip.textContent).toMatch(/active/i);
  });

  it("does NOT render Lifecycle-status flip buttons (deferred to #5)", () => {
    renderWorksheet();
    // The flip buttons are accessible buttons keyed by Lifecycle status
    // label. No button should announce itself as "set status to grey" etc.
    expect(
      screen.queryByRole("button", { name: /set status to/i }),
    ).toBeNull();
  });

  it("does NOT render any edit / log-a-call / add-contact affordances (deferred)", () => {
    renderWorksheet({
      primaryContact: {
        id: "c-1",
        full_name: "Pat Smith",
        phone: null,
        email: null,
      },
      contacts: [
        { id: "c-1", full_name: "Pat Smith", phone: null, email: null },
      ],
    });
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /log a call/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add contact/i })).toBeNull();
    // No form controls at all in this read-only slice.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("renders a company-info section listing the partner's columns", () => {
    renderWorksheet();
    const section = screen.getByTestId("worksheet-company-info");
    // Spot-check the columns: industry, office phone (formatted), office
    // email, website, address. The presentational rule is "show every
    // partner column read-only" — the test pins the visible ones.
    expect(section.textContent).toContain("Plumbing");
    expect(section.textContent).toContain("(555) 123-0001");
    expect(section.textContent).toContain("ops@acme.test");
    expect(section.textContent).toContain("acme.test");
    expect(section.textContent).toContain("100 Main St");
  });

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
    // Phone is formatted via the platform's `formatPhoneNumber`.
    expect(slot.textContent).toContain("(555) 555-0100");
    expect(slot.textContent).toContain("pat@acme.test");
  });

  it("renders the Owner contact slot as 'Not set' when no owner is linked", () => {
    renderWorksheet({ ownerContact: null });
    const slot = screen.getByTestId("worksheet-owner-contact");
    expect(slot.textContent).toMatch(/owner contact/i);
    expect(slot.textContent).toMatch(/not set/i);
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
