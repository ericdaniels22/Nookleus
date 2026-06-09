// CustomerCard (#570) — read-only customer card sourced from the Job's contact.
// The Estimate stores no customer of its own: the card displays the Job's
// contact, offers a soft "manage on the Job" hint when there is none, is
// collapsible, and renders nothing in Estimate-template mode.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CustomerCard } from "./customer-card";
import type { Contact, Job } from "@/lib/types";

const contact: Contact = {
  id: "contact-1",
  organization_id: "org-1",
  full_name: "Dana Whitfield",
  phone: "4255550123",
  email: "dana@example.com",
  role: "homeowner",
  company: null,
  title: null,
  notes: null,
  created_at: "",
  updated_at: "",
};

const job: Omit<Job, "contact"> & { contact: Contact | null } = {
  id: "job-1",
  organization_id: "org-1",
  job_number: "24-001",
  contact_id: contact.id,
  status: "active",
  urgency: "scheduled",
  damage_type: "water",
  damage_source: null,
  property_address: "12 Cedar Ln, Bellevue, WA",
  property_type: "single_family",
  property_sqft: null,
  property_stories: null,
  affected_areas: null,
  insurance_company: null,
  insurance_contact_id: null,
  referral_partner_id: null,
  claim_number: null,
  policy_number: null,
  payer_type: null,
  date_of_loss: null,
  deductible: null,
  estimated_crew_labor_cost: null,
  hoa_name: null,
  hoa_contact_name: null,
  hoa_contact_phone: null,
  hoa_contact_email: null,
  access_notes: null,
  cover_photo_id: null,
  created_at: "",
  updated_at: "",
  contact,
};

describe("CustomerCard — read-only display from the Job's contact", () => {
  it("shows the contact's name, email, formatted phone, and property address with no editable fields", () => {
    const { container } = render(<CustomerCard job={job} />);

    expect(screen.getByText("Dana Whitfield")).toBeDefined();
    expect(screen.getByText("dana@example.com")).toBeDefined();
    expect(screen.getByText("(425) 555-0123")).toBeDefined();
    expect(screen.getByText("12 Cedar Ln, Bellevue, WA")).toBeDefined();

    // Read-only: nothing about the customer is editable on the Estimate.
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });
});

describe("CustomerCard — Job without a contact", () => {
  it("shows a soft 'manage the customer on the Job' hint and no add-customer form", () => {
    const { container } = render(
      <CustomerCard job={{ ...job, contact: null }} />,
    );

    expect(screen.getByText(/manage the customer on the job/i)).toBeDefined();

    // Intentionally no add-customer empty state: no form fields, and no
    // call-to-action button to create a customer here.
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
  });
});

describe("CustomerCard — collapsible", () => {
  it("collapse hides the detail lines but keeps the customer's name; expand restores them", () => {
    render(<CustomerCard job={job} />);

    fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
    expect(screen.queryByText("dana@example.com")).toBeNull();
    expect(screen.queryByText("(425) 555-0123")).toBeNull();
    expect(screen.getByText("Dana Whitfield")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /expand/i }));
    expect(screen.getByText("dana@example.com")).toBeDefined();
    expect(screen.getByText("(425) 555-0123")).toBeDefined();
  });
});

describe("CustomerCard — builder modes", () => {
  it("renders nothing in Estimate-template mode", () => {
    const { container } = render(<CustomerCard job={job} mode="template" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the same read-only card in Invoice mode", () => {
    const { container } = render(<CustomerCard job={job} mode="invoice" />);
    expect(screen.getByText("Dana Whitfield")).toBeDefined();
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });
});
