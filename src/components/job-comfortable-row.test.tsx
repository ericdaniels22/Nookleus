import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import type { Job, Photo } from "@/lib/types";
import { getJobStatusPresentation } from "@/lib/job-status-presentation";

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

// The row embeds JobCoverPicker, which loads the job's photos and writes
// jobs.cover_photo_id. This stub serves one photo ("Kitchen") to the
// picker and lets the cover write succeed, so the row's update-in-place
// behavior can be exercised end to end.
vi.mock("@/lib/supabase", () => {
  const kitchenPhoto = {
    id: "kitchen-photo",
    job_id: "job-1",
    storage_path: "job-1/kitchen.jpg",
    annotated_path: null,
    caption: "Kitchen",
    taken_at: null,
    taken_by: "user-1",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-20T00:00:00Z",
  };
  return {
    createClient: () => ({
      from: (table: string) => {
        if (table === "jobs") {
          return {
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        }
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order"]) {
          builder[method] = () => builder;
        }
        builder.then = (resolve: (r: unknown) => void) =>
          resolve({ data: [kitchenPhoto], error: null });
        return builder;
      },
    }),
  };
});

import JobComfortableRow from "./job-comfortable-row";
import { asRenderedColor, expectedStageIconGeometry } from "./jobs-test-helpers";

afterEach(() => vi.unstubAllEnvs());

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-1",
    job_id: "job-1",
    storage_path: "job-1/original.jpg",
    annotated_path: null,
    caption: null,
    taken_at: null,
    taken_by: "user-1",
    media_type: "photo",
    file_size: null,
    width: null,
    height: null,
    before_after_pair_id: null,
    before_after_role: null,
    created_at: "2026-05-20T00:00:00Z",
    organization_id: "org-1",
    uploaded_from: "web",
    client_capture_id: null,
    ...overrides,
  };
}

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
    cover_photo: null,
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

describe("JobComfortableRow — stage color stripe (#724)", () => {
  it("renders a left-edge stripe colored for the job's stage", () => {
    render(<JobComfortableRow job={makeJob({ status: "cancelled" })} />);

    const stripe = screen.getByTestId("stage-stripe");
    expect(stripe.style.backgroundColor).toBe(
      asRenderedColor(getJobStatusPresentation("cancelled").accentColor),
    );
  });
});

describe("JobComfortableRow — stage icon (#727)", () => {
  it("renders the job's stage icon with the status badge", () => {
    const { container } = render(
      <JobComfortableRow job={makeJob({ status: "completed" })} />,
    );

    const icon = container.querySelector('[data-testid="stage-icon"]');
    // Present, and the right glyph for the job's own stage (Closed → check).
    expect(icon).not.toBeNull();
    expect(icon!.innerHTML).toBe(expectedStageIconGeometry("completed"));
  });

  it("binds the icon to the status badge so flex-wrap can't orphan it", () => {
    render(<JobComfortableRow job={makeJob({ status: "completed" })} />);

    const icon = screen.getByTestId("stage-icon");
    const statusBadge = screen.getByText("completed");
    const urgencyBadge = screen.getByText("Urgent");

    // Icon + status badge share a dedicated, non-wrapping container, so the
    // glyph always reads immediately before its label — matching how the card
    // and list-row bind the pair (AC #3 cross-variant consistency)...
    expect(icon.parentElement).toBe(statusBadge.parentElement);
    expect(icon.parentElement?.className).not.toContain("flex-wrap");
    // ...and that container is separate from the wrapping urgency/damage row.
    expect(icon.parentElement).not.toBe(urgencyBadge.parentElement);
  });
});

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

describe("JobComfortableRow — cover picker entry point (#164)", () => {
  it("opens the cover picker when the placeholder is clicked on a job with no cover", async () => {
    render(<JobComfortableRow job={makeJob({ cover_photo: null })} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cover photo/i }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("opens the cover picker when an existing cover thumbnail is clicked", async () => {
    render(
      <JobComfortableRow
        job={makeJob({ cover_photo: makePhoto({ id: "cover-A" }) })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cover photo/i }));
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("still links the row body to the job detail page", () => {
    render(<JobComfortableRow job={makeJob()} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe("/jobs/job-1");
  });
});

describe("JobComfortableRow — cover updates in place (#164)", () => {
  it("swaps the placeholder for the chosen cover thumbnail without a reload", async () => {
    render(<JobComfortableRow job={makeJob({ cover_photo: null })} />);

    // No cover yet — the thumbnail button offers to choose one.
    expect(
      screen.getByRole("button", { name: "Choose cover photo" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /cover photo/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Kitchen" }));

    // The picker closed and the row now shows a real cover thumbnail,
    // re-rendered from local state — no navigation, no parent refetch.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Change cover photo" }),
      ).toBeDefined(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("JobComfortableRow — resized cover preview (#420)", () => {
  it("requests the grid-variant preview for the cover thumbnail when resize is enabled", () => {
    // Acceptance #1 at the display boundary: the Comfortable row's small
    // cover thumbnail must not pull a multi-MB original. With image
    // transformation on, its <img> src is the resized render URL.
    vi.stubEnv("NEXT_PUBLIC_PHOTO_RESIZE_ENABLED", "true");
    render(
      <JobComfortableRow
        job={makeJob({
          cover_photo: makePhoto({ storage_path: "job-1/cover.jpg" }),
        })}
      />,
    );

    const cover = screen
      .getByRole("button", { name: "Change cover photo" })
      .querySelector("img");
    expect(cover?.getAttribute("src")).toContain(
      "/storage/v1/render/image/public/photos/",
    );
    expect(cover?.getAttribute("src")).toContain("width=400");
  });
});
