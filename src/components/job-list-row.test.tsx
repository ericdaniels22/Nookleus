import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Job } from "@/lib/types";

// JobListRow reads status/damage colors + labels from the config context.
// Stub it so the row renders without a ConfigProvider; the stubbed color
// strings double as a marker that the row threaded the lookups through.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusColor: (name: string) => `status-color-${name}`,
    getStatusLabel: (name: string) =>
      name === "in_progress" ? "In Progress" : name,
    getDamageTypeColor: (name: string) => `damage-color-${name}`,
    getDamageTypeLabel: (name: string) => (name === "water" ? "Water" : name),
  }),
}));

import JobListRow, { JobListHeader } from "./job-list-row";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    job_number: "JOB-1001",
    contact_id: "c-1",
    status: "in_progress",
    urgency: "urgent",
    damage_type: "water",
    damage_source: null,
    property_address: "123 Main St",
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
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    contact: {
      id: "c-1",
      full_name: "Jane Homeowner",
      phone: null,
      email: null,
      role: "homeowner",
      company: null,
      title: null,
      notes: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
    },
    ...overrides,
  };
}

describe("JobListRow — core fields (#161)", () => {
  it("shows job number, contact, and property address", () => {
    render(<JobListRow job={makeJob()} />);

    expect(screen.getByText("JOB-1001")).toBeDefined();
    expect(screen.getByText("Jane Homeowner")).toBeDefined();
    expect(screen.getByText("123 Main St")).toBeDefined();
  });

  it("links the whole row to the job detail page", () => {
    render(<JobListRow job={makeJob()} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/jobs/job-1");
  });
});

describe("JobListRow — status / urgency / damage badges (#161)", () => {
  it("renders colored status, urgency, and damage-type badges", () => {
    render(<JobListRow job={makeJob()} />);

    const status = screen.getByText("In Progress");
    const urgency = screen.getByText("Urgent");
    const damage = screen.getByText("Water");

    // Each badge carries its config-driven / urgency color class.
    expect(status.className).toContain("status-color-in_progress");
    expect(urgency.className).toContain("bg-amber-100"); // urgencyColors.urgent
    expect(damage.className).toContain("damage-color-water");
  });

  it("hides the status and damage columns below the sm breakpoint", () => {
    render(<JobListRow job={makeJob()} />);

    const statusCell = screen.getByText("In Progress").parentElement;
    const damageCell = screen.getByText("Water").parentElement;

    for (const cell of [statusCell, damageCell]) {
      expect(cell?.className).toContain("hidden");
      expect(cell?.className).toContain("sm:block");
    }
  });
});

describe("JobListRow — mobile urgency edge stripe (#161)", () => {
  it("renders a phone-only urgency-colored left-edge stripe", () => {
    render(<JobListRow job={makeJob({ urgency: "urgent" })} />);

    const stripe = screen.getByTestId("urgency-stripe");
    expect(stripe.className).toContain("bg-amber-500");
    // Stripe is the phone stand-in for the urgency badge — gone at sm+.
    expect(stripe.className).toContain("sm:hidden");
  });

  it("colors the stripe red for emergency jobs", () => {
    render(<JobListRow job={makeJob({ urgency: "emergency" })} />);

    expect(screen.getByTestId("urgency-stripe").className).toContain(
      "bg-red-500",
    );
  });
});

describe("JobListHeader (#161)", () => {
  it("renders the six column labels", () => {
    render(<JobListHeader />);

    for (const label of [
      "Job #",
      "Contact",
      "Address",
      "Status",
      "Urgency",
      "Damage",
    ]) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it("is a label row only — not clickable for sorting", () => {
    render(<JobListHeader />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
