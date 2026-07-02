import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Job } from "@/lib/types";
import { NewJobsSection } from "./new-jobs-section";

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

describe("<NewJobsSection>", () => {
  it("shows a shared EmptyState (headline + intake CTA) when total is 0", () => {
    render(<NewJobsSection jobs={[]} total={0} />);

    expect(screen.getByText("No new jobs")).toBeTruthy();
    const cta = screen.getByRole("link", { name: /start an intake/i });
    expect(cta.getAttribute("href")).toBe("/intake");
  });

  it("renders skeleton rows while loading, not the empty state or rows", () => {
    const { container } = render(
      <NewJobsSection jobs={[]} total={0} loading />,
    );

    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText("No new jobs")).toBeNull();
  });

  it("renders an error state when the load failed", () => {
    render(<NewJobsSection jobs={[]} total={0} error="boom" />);

    expect(screen.getByText(/couldn't load new jobs/i)).toBeTruthy();
    // A raw exception string never reaches the UI (§6).
    expect(screen.queryByText("boom")).toBeNull();
    expect(screen.queryByText("No new jobs")).toBeNull();
  });

  it("wraps each preview row in an anchor to /jobs/<id>", () => {
    const jobs = [
      makeJob({ id: "aaa", job_number: "J-A" }),
      makeJob({ id: "bbb", job_number: "J-B" }),
    ];
    render(<NewJobsSection jobs={jobs} total={2} />);

    const aRow = screen.getByText("J-A").closest("a");
    const bRow = screen.getByText("J-B").closest("a");
    expect(aRow?.getAttribute("href")).toBe("/jobs/aaa");
    expect(bRow?.getAttribute("href")).toBe("/jobs/bbb");
  });

  it("renders a `View all jobs` link in the header pointing to /jobs", () => {
    render(<NewJobsSection jobs={[makeJob()]} total={1} />);
    const link = screen.getByRole("link", { name: /view all jobs/i });
    expect(link.getAttribute("href")).toBe("/jobs");
  });

  it("does not render a `+ N more` tail when total ≤ 3", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" }), makeJob({ id: "c" })];
    render(<NewJobsSection jobs={jobs} total={3} />);
    expect(screen.queryByText(/\+ \d+ more/)).toBeNull();
  });

  it("renders `+ N more` linking to /jobs when total exceeds the preview cap", () => {
    const jobs = [makeJob({ id: "a" }), makeJob({ id: "b" }), makeJob({ id: "c" })];
    render(<NewJobsSection jobs={jobs} total={7} />);
    const tail = screen.getByText("+ 4 more");
    // Tail is wrapped in an anchor to /jobs.
    const anchor = tail.closest("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/jobs");
  });

  it("renders up to 3 preview rows plus a count pill of the total", () => {
    const jobs = [
      makeJob({ id: "a", job_number: "J-A" }),
      makeJob({ id: "b", job_number: "J-B" }),
      makeJob({ id: "c", job_number: "J-C" }),
    ];
    render(<NewJobsSection jobs={jobs} total={3} />);

    expect(screen.getByText("J-A")).toBeTruthy();
    expect(screen.getByText("J-B")).toBeTruthy();
    expect(screen.getByText("J-C")).toBeTruthy();

    // Count pill — total reflected somewhere distinct from the rows.
    const pill = screen.getByTestId("new-jobs-count");
    expect(pill.textContent).toContain("3");
  });
});
