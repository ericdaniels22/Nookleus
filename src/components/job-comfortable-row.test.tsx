import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Job } from "@/lib/types";

// JobComfortableRow reads status/damage colors + labels from the config
// context. Stub it so the row renders without a ConfigProvider; the
// stubbed color strings double as a marker that the row threaded the
// lookups through.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusColor: (name: string) => `status-color-${name}`,
    getStatusLabel: (name: string) =>
      name === "in_progress" ? "In Progress" : name,
    getDamageTypeColor: (name: string) => `damage-color-${name}`,
    getDamageTypeLabel: (name: string) => (name === "water" ? "Water" : name),
  }),
}));

import JobComfortableRow from "./job-comfortable-row";

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
    cover_photo: null,
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

describe("JobComfortableRow — status / urgency / damage badges (#163)", () => {
  it("renders colored status, urgency, and damage-type badges", () => {
    render(<JobComfortableRow job={makeJob()} />);

    const status = screen.getByText("In Progress");
    const urgency = screen.getByText("Urgent");
    const damage = screen.getByText("Water");

    // Each badge carries its config-driven / urgency color class.
    expect(status.className).toContain("status-color-in_progress");
    expect(urgency.className).toContain("bg-amber-100"); // urgencyColors.urgent
    expect(damage.className).toContain("damage-color-water");
  });
});

describe("JobComfortableRow — photo / file counts (#163)", () => {
  it("shows the job's photo count and file count", () => {
    render(
      <JobComfortableRow job={makeJob({ photo_count: 7, file_count: 3 })} />,
    );

    const counts = screen.getByTestId("job-counts");
    expect(counts.textContent).toContain("7");
    expect(counts.textContent).toContain("3");
  });

  it("shows a count of 0 for a job with no photos or files", () => {
    render(
      <JobComfortableRow job={makeJob({ photo_count: 0, file_count: 0 })} />,
    );

    const counts = screen.getByTestId("job-counts");
    expect(counts.textContent).toContain("0");
  });

  it("hides the counts below the sm breakpoint, keeping the badges", () => {
    render(
      <JobComfortableRow job={makeJob({ photo_count: 7, file_count: 3 })} />,
    );

    // The count column collapses on a phone-width row...
    const counts = screen.getByTestId("job-counts");
    expect(counts.className).toContain("hidden");
    expect(counts.className).toContain("sm:flex");

    // ...but the status badge — like the urgency and damage badges — is
    // never hidden, so the row stays informative on a small screen. The
    // badges wrap (the Badge base class carries `overflow-hidden`), so
    // assert against the standalone `hidden` utility class, not a
    // substring.
    const classes = (el: Element | null | undefined) =>
      (el?.className ?? "").split(/\s+/);
    const statusBadge = screen.getByText("In Progress");
    expect(classes(statusBadge)).not.toContain("hidden");
    expect(classes(statusBadge.parentElement)).not.toContain("hidden");
  });
});
