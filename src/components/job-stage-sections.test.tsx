// Issue #723 — Jobs page stage-grouped sections (presentational component).
//
// <JobStageSections> renders the sections from buildJobSections as colored
// stage headers carrying a count, delegating each section's Job rendering to a
// `renderJobs` prop so grouping stays orthogonal to the page's view-mode
// (grid / list / comfortable).

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Job } from "@/lib/types";
import { buildJobSections } from "@/lib/jobs/build-job-sections";
import { JobStageSections } from "./job-stage-sections";

function makeJob(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    job_number: "J-0001",
    contact_id: "c-1",
    status: "new",
    urgency: "scheduled",
    damage_type: "water",
    damage_source: null,
    property_address: "1 Test St",
    property_type: "single_family",
    property_sqft: null,
    property_stories: null,
    affected_areas: null,
    insurance_company: null,
    insurance_contact_id: null,
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
    created_at: "2026-05-27T10:00:00Z",
    ...over,
  } as Job;
}

describe("<JobStageSections>", () => {
  it("renders a header per populated stage, in page order", () => {
    const sections = buildJobSections([
      makeJob({ id: "a", status: "in_progress" }),
      makeJob({ id: "l", status: "new" }),
      makeJob({ id: "c", status: "pending_invoice" }),
    ]);

    render(<JobStageSections sections={sections} renderJobs={() => null} />);

    const headers = screen.getAllByRole("heading", { level: 2 });
    expect(headers.map((h) => h.textContent)).toEqual([
      expect.stringContaining("Active"),
      expect.stringContaining("Lead"),
      expect.stringContaining("Collections"),
    ]);
  });

  it("shows each section's Job count in its header", () => {
    const sections = buildJobSections([
      makeJob({ id: "a1", status: "in_progress" }),
      makeJob({ id: "a2", status: "in_progress" }),
      makeJob({ id: "l1", status: "new" }),
    ]);

    render(<JobStageSections sections={sections} renderJobs={() => null} />);

    expect(screen.getByTestId("section-in_progress-count").textContent).toBe(
      "2",
    );
    expect(screen.getByTestId("section-new-count").textContent).toBe("1");
  });

  it("renders each section's Jobs under its own header via renderJobs", () => {
    const sections = buildJobSections([
      makeJob({ id: "active-1", status: "in_progress" }),
      makeJob({ id: "lead-1", status: "new" }),
    ]);

    render(
      <JobStageSections
        sections={sections}
        renderJobs={(jobs) => (
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>{j.id}</li>
            ))}
          </ul>
        )}
      />,
    );

    const activeSection = screen.getByTestId("section-in_progress");
    expect(within(activeSection).getByText("active-1")).toBeTruthy();
    expect(within(activeSection).queryByText("lead-1")).toBeNull();
  });
});

// Issue #726 — open emergencies render in a pinned section above the stage
// groups. The pinned Jobs arrive via the optional `pinnedEmergencies` prop
// (the page lifts them out with buildJobsPageSections); the component just
// renders them first.
describe("<JobStageSections> — pinned emergencies (#726)", () => {
  const renderIds = (jobs: Job[]) => (
    <ul>
      {jobs.map((j) => (
        <li key={j.id}>{j.id}</li>
      ))}
    </ul>
  );

  it("renders the pinned emergencies in their own section", () => {
    render(
      <JobStageSections
        sections={buildJobSections([
          makeJob({ id: "active-1", status: "in_progress" }),
        ])}
        pinnedEmergencies={[
          makeJob({ id: "emg-1", status: "in_progress", urgency: "emergency" }),
        ]}
        renderJobs={renderIds}
      />,
    );

    const pinned = screen.getByTestId("section-emergency");
    expect(within(pinned).getByText("emg-1")).toBeTruthy();
  });

  it("renders the pinned section above the stage groups", () => {
    render(
      <JobStageSections
        sections={buildJobSections([
          makeJob({ id: "active-1", status: "in_progress" }),
        ])}
        pinnedEmergencies={[
          makeJob({ id: "emg-1", status: "in_progress", urgency: "emergency" }),
        ]}
        renderJobs={renderIds}
      />,
    );

    const pinned = screen.getByTestId("section-emergency");
    const stage = screen.getByTestId("section-in_progress");
    // DOCUMENT_POSITION_FOLLOWING is set when `stage` comes after `pinned`.
    expect(
      pinned.compareDocumentPosition(stage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders no pinned section when there are no emergencies", () => {
    const { rerender } = render(
      <JobStageSections
        sections={buildJobSections([
          makeJob({ id: "active-1", status: "in_progress" }),
        ])}
        pinnedEmergencies={[]}
        renderJobs={renderIds}
      />,
    );

    expect(screen.queryByTestId("section-emergency")).toBeNull();

    // …and the prop is genuinely optional — omitting it renders nothing too.
    rerender(
      <JobStageSections
        sections={buildJobSections([
          makeJob({ id: "active-1", status: "in_progress" }),
        ])}
        renderJobs={renderIds}
      />,
    );

    expect(screen.queryByTestId("section-emergency")).toBeNull();
  });
});
