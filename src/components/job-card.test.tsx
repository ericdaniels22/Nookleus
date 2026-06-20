import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Job } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";

// JobCard reads status/damage colors + labels (and the damageTypes list) from
// the config context. Stub it so the card renders without a ConfigProvider.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusColor: (name: string) => `status-color-${name}`,
    getStatusLabel: (name: string) =>
      name === "in_progress" ? "In Progress" : name,
    getDamageTypeColor: (name: string) => `damage-color-${name}`,
    getDamageTypeLabel: (name: string) => (name === "water" ? "Water" : name),
    damageTypes: [],
  }),
}));

import JobCard from "./job-card";
import { asRenderedColor } from "./jobs-test-helpers";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    organization_id: "org-1",
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
      organization_id: "org-1",
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

describe("JobCard — stage color stripe (#724)", () => {
  it("renders a left-edge stripe colored for the job's stage", () => {
    render(<JobCard job={makeJob({ status: "cancelled" })} />);

    const stripe = screen.getByTestId("stage-stripe");
    // Wired to the job's own status, not a hardcoded stage.
    expect(stripe.style.backgroundColor).toBe(
      asRenderedColor(getJobStatusPresentation("cancelled").accentColor),
    );
  });
});
