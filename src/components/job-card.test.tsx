import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Job } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";

// JobCard reads the status/damage config rows + labels and passes them through
// the §2.6 badge resolvers (#914). Stub the context so the card renders without
// a ConfigProvider; empty status/damage lists exercise the presentation-seed /
// canonical-class fallbacks, so the badges still render their tint treatment.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusLabel: (name: string) =>
      name === "in_progress" ? "In Progress" : name,
    getDamageTypeLabel: (name: string) => (name === "water" ? "Water" : name),
    statuses: [],
    damageTypes: [],
  }),
}));

import JobCard from "./job-card";
import { asRenderedColor, expectedStageIconGeometry } from "./jobs-test-helpers";

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

describe("JobCard — stage icon (#727)", () => {
  it("renders the job's stage icon so the stage reads at a glance", () => {
    const { container } = render(
      <JobCard job={makeJob({ status: "pending_invoice" })} />,
    );

    const icon = container.querySelector('[data-testid="stage-icon"]');
    // Present, and the right glyph for the job's own stage (Collections).
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe(expectedStageIconGeometry("pending_invoice"));
  });
});

describe("JobCard — badge tint treatment (#914)", () => {
  it("renders status as a soften tint, damage as its vivid class, urgency as warning", () => {
    render(<JobCard job={makeJob()} />);

    const status = screen.getByText("In Progress");
    const damage = screen.getByText("Water");
    const urgency = screen.getByText("Urgent");

    // Status: restyled into an inline soften tint (§2.6), not a solid fill.
    expect(status.getAttribute("style") ?? "").toMatch(/rgba?\(/);
    expect(status.className).not.toContain("bg-[");
    // Damage: uncustomized Water → vivid §2.6 dark-tint class.
    expect(damage.className).toContain("text-sky-300");
    // Urgency: §2.6 semantic warning tint.
    expect(urgency.className).toContain("bg-amber-400/14");
  });
});
