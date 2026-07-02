import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Job } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";

// JobListRow reads the status/damage config rows + labels from the config
// context and passes them through the §2.6 badge resolvers (#914). Stub the
// context so the row renders without a ConfigProvider: an in_progress status
// row carries a distinctive bg (#123456) so the soften tint is traceable back
// to the config as its source, and damageTypes is left empty so an
// uncustomized Water resolves to its vivid canonical class.
vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({
    getStatusLabel: (name: string) =>
      name === "in_progress" ? "In Progress" : name,
    getDamageTypeLabel: (name: string) => (name === "water" ? "Water" : name),
    statuses: [
      {
        id: "s1",
        name: "in_progress",
        display_label: "In Progress",
        bg_color: "#123456",
        text_color: "#88CCFF",
        sort_order: 0,
        is_default: true,
        created_at: "",
        updated_at: "",
      },
    ],
    damageTypes: [],
  }),
}));

import JobListRow, { JobListHeader } from "./job-list-row";
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
  it("renders tint-treatment status, urgency, and damage-type badges (#914)", () => {
    render(<JobListRow job={makeJob()} />);

    const status = screen.getByText("In Progress");
    const urgency = screen.getByText("Urgent");
    const damage = screen.getByText("Water");

    // Status: still config-sourced (ADR 0022), restyled into a soften tint —
    // an inline color derived from the config bg (#123456 → r=18), never the
    // old solid `bg-[#hex]` fill.
    const statusStyle = status.getAttribute("style") ?? "";
    expect(statusStyle).toMatch(/rgba?\(/);
    expect(statusStyle).toContain("18");
    expect(status.className).not.toContain("bg-[");
    // Urgency: §2.6 semantic warning tint (was the stale light bg-amber-100).
    expect(urgency.className).toContain("bg-amber-400/14");
    // Damage: uncustomized Water → vivid §2.6 dark-tint class.
    expect(damage.className).toContain("text-sky-300");
    expect(damage.getAttribute("style") ?? "").not.toMatch(/rgba?\(/);
  });

  it("keeps the badges visible on phone as a card-row cluster (#914)", () => {
    render(<JobListRow job={makeJob()} />);

    const statusCell = screen.getByText("In Progress").parentElement;
    const urgencyCell = screen.getByText("Urgent").parentElement;
    const damageCell = screen.getByText("Water").parentElement;

    // #914: on phone the dense table collapses to a card row that STILL shows
    // its badges — none of the three badge columns are hidden below sm anymore
    // (previously they were `hidden sm:*`, so the badges vanished on a phone).
    expect(statusCell?.className).not.toContain("hidden");
    expect(urgencyCell?.className).not.toContain("hidden");
    expect(damageCell?.className).not.toContain("hidden");

    // At sm+ each column takes its fixed width so the rows line up as a table
    // again: the shared badge wrapper is `display:contents` there, promoting
    // the three columns to direct row children aligned across every row.
    expect(statusCell?.className).toContain("sm:w-28");
    expect(urgencyCell?.className).toContain("sm:w-24");
    expect(damageCell?.className).toContain("sm:w-24");

    // On phone the three badges share one wrapping cluster, so they flow onto
    // their own line beneath the name/address instead of forcing a sideways
    // scroll; that wrapper dissolves (`sm:contents`) back into columns at sm+.
    const cluster = statusCell?.parentElement;
    expect(cluster?.className).toContain("flex-wrap");
    expect(cluster?.className).toContain("sm:contents");
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

describe("JobListRow — stage color stripe (#724)", () => {
  it("renders an always-on left-edge stripe colored for the job's stage", () => {
    render(<JobListRow job={makeJob({ status: "cancelled" })} />);

    const stripe = screen.getByTestId("stage-stripe");
    expect(stripe.style.backgroundColor).toBe(
      asRenderedColor(getJobStatusPresentation("cancelled").accentColor),
    );
    // Unlike the urgency stripe, the stage stripe shows at every breakpoint.
    expect(stripe.className).not.toContain("sm:hidden");
  });

  it("sits the phone urgency stripe just inside the stage stripe (no overlap)", () => {
    render(<JobListRow job={makeJob({ urgency: "emergency" })} />);

    const stage = screen.getByTestId("stage-stripe");
    const urgency = screen.getByTestId("urgency-stripe");

    // The stage stripe owns the very edge; the urgency stripe is shifted one
    // stripe-width inward so on a phone both colors read side by side.
    expect(stage.className).toContain("left-0");
    expect(urgency.className).toContain("left-1");
    expect(urgency.className).not.toContain("left-0");
  });
});

describe("JobListRow — stage icon (#727)", () => {
  it("renders the job's stage icon alongside the status badge", () => {
    const { container } = render(<JobListRow job={makeJob({ status: "new" })} />);

    const icon = container.querySelector('[data-testid="stage-icon"]');
    // Present, and the right glyph for the job's own stage (Lead → sprout).
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe(expectedStageIconGeometry("new"));
  });

  it("pairs the icon with the status badge in the status column", () => {
    render(<JobListRow job={makeJob({ status: "new" })} />);

    // The icon shares the (phone-hidden) status column with the badge, so the
    // two read together and the stripe still carries the stage on a phone.
    const statusCell = screen.getByText("new").parentElement;
    expect(statusCell?.querySelector('[data-testid="stage-icon"]')).not.toBeNull();
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
