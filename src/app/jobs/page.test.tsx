// Issue #725 — Jobs page: all five stages selectable as filter pills.
//
// Lead and Lost were excluded from the filter pills; this surfaces all five
// stages (Lead, Active, Collections, Closed, Lost) alongside the existing
// All / Emergency / Trash, and each pill drives the page's fetch to that
// stage. The pills are sourced from the status-presentation module so they
// stay in pipeline order and can't drop or duplicate a stage.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";

// Shared, mutable test state — declared via vi.hoisted so the hoisted
// vi.mock factories below can reference it safely.
const h = vi.hoisted(() => ({
  role: "admin",
  statuses: [
    { name: "new", display_label: "Lead", sort_order: 1 },
    { name: "in_progress", display_label: "Active", sort_order: 2 },
    { name: "pending_invoice", display_label: "Collections", sort_order: 3 },
    { name: "completed", display_label: "Closed", sort_order: 4 },
    { name: "cancelled", display_label: "Lost", sort_order: 5 },
  ],
}));

vi.mock("@/lib/config-context", () => ({
  useConfig: () => ({ statuses: h.statuses }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ profile: { role: h.role } }),
}));

vi.mock("@/lib/jobs/use-jobs-view-mode", () => ({
  useJobsViewMode: () => ({ mode: "comfortable", setMode: vi.fn() }),
}));

// The fetch seam: the page calls loadJobsWithCover(supabase, filter). Spy on
// it so we can assert which stage each pill fetches.
vi.mock("@/lib/jobs/jobs-with-cover", () => ({
  loadJobsWithCover: vi.fn(async () => []),
}));

// The page's "stats" effect builds a client and runs one aggregate read; a
// thenable builder that resolves to no rows keeps that effect quiet.
vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      is: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    return { from: () => builder };
  }),
}));

import JobsPage from "./page";
import { loadJobsWithCover } from "@/lib/jobs/jobs-with-cover";

const loadJobs = vi.mocked(loadJobsWithCover);

/** The stage key fetched by the most recent loadJobsWithCover call. */
function lastFilter(): unknown {
  return loadJobs.mock.lastCall?.[1];
}

/** Render the page and wait for its initial ("all") fetch to settle. */
async function renderMounted() {
  render(<JobsPage />);
  await waitFor(() => expect(loadJobs).toHaveBeenCalled());
}

beforeEach(() => {
  h.role = "admin";
  loadJobs.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("Jobs page — five-stage filter pills (#725)", () => {
  // The newly-filterable stages: Lead (new) and Lost (cancelled) were
  // excluded from the pills before this slice.
  it("makes Lead selectable: clicking the Lead pill fetches Lead jobs", async () => {
    await renderMounted();

    fireEvent.click(screen.getByTestId("filter-pill-new"));

    await waitFor(() => expect(lastFilter()).toBe("new"));
  });

  it("makes Lost selectable: clicking the Lost pill fetches Lost jobs", async () => {
    await renderMounted();

    fireEvent.click(screen.getByTestId("filter-pill-cancelled"));

    await waitFor(() => expect(lastFilter()).toBe("cancelled"));
  });

  // The three stages that were already filterable keep working.
  it.each([
    ["in_progress", "Active"],
    ["pending_invoice", "Collections"],
    ["completed", "Closed"],
  ])(
    "filters to the %s stage when its pill is clicked",
    async (key) => {
      await renderMounted();

      fireEvent.click(screen.getByTestId(`filter-pill-${key}`));

      await waitFor(() => expect(lastFilter()).toBe(key));
    },
  );

  // All / Emergency continue to behave exactly as before.
  it("All fetches the unfiltered list", async () => {
    await renderMounted();

    fireEvent.click(screen.getByTestId("filter-pill-emergency"));
    await waitFor(() => expect(lastFilter()).toBe("emergency"));

    fireEvent.click(screen.getByTestId("filter-pill-all"));
    await waitFor(() => expect(lastFilter()).toBe("all"));
  });

  it("Emergency fetches the emergency list", async () => {
    await renderMounted();

    fireEvent.click(screen.getByTestId("filter-pill-emergency"));

    await waitFor(() => expect(lastFilter()).toBe("emergency"));
  });

  it("renders all pills in pipeline order: All, Emergency, the five stages, Trash", async () => {
    await renderMounted();

    const ids = screen
      .getAllByTestId(/^filter-pill-/)
      .map((el) => el.getAttribute("data-testid"));

    expect(ids).toEqual([
      "filter-pill-all",
      "filter-pill-emergency",
      "filter-pill-new",
      "filter-pill-in_progress",
      "filter-pill-pending_invoice",
      "filter-pill-completed",
      "filter-pill-cancelled",
      "filter-pill-trash",
    ]);
  });

  it("labels the stage pills with their display labels", async () => {
    await renderMounted();

    expect(screen.getByTestId("filter-pill-new").textContent).toBe("Lead");
    expect(screen.getByTestId("filter-pill-in_progress").textContent).toBe(
      "Active",
    );
    expect(screen.getByTestId("filter-pill-pending_invoice").textContent).toBe(
      "Collections",
    );
    expect(screen.getByTestId("filter-pill-completed").textContent).toBe(
      "Closed",
    );
    expect(screen.getByTestId("filter-pill-cancelled").textContent).toBe(
      "Lost",
    );
  });

  // Trash stays gated to roles that can delete jobs; the five stages remain
  // visible to everyone.
  it("hides the Trash pill for non-deleters but keeps all five stages", async () => {
    h.role = "crew_member";
    await renderMounted();

    expect(screen.queryByTestId("filter-pill-trash")).toBeNull();

    for (const key of [
      "new",
      "in_progress",
      "pending_invoice",
      "completed",
      "cancelled",
    ]) {
      expect(screen.getByTestId(`filter-pill-${key}`)).toBeTruthy();
    }
  });
});
