import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the hook at the import boundary so the page test doesn't touch
// Supabase. Per #293's plan, the hook owns the fetch + 30s polling.
const useDashboardDataMock = vi.fn();
vi.mock("@/lib/dashboard/use-dashboard-data", () => ({
  useDashboardData: () => useDashboardDataMock(),
}));

// Stub auth context so the greeting comes from a fixed profile.
const useAuthMock = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => useAuthMock(),
}));

import DashboardPage from "./page";

describe("DashboardPage — action hub", () => {
  beforeEach(() => {
    useDashboardDataMock.mockReset();
    useAuthMock.mockReset();
  });

  it("renders the greeting derived from profile.full_name", () => {
    useAuthMock.mockReturnValue({
      profile: { full_name: "Eric Daniels" },
    });
    useDashboardDataMock.mockReturnValue({
      newJobs: [],
      newJobsCount: 0,
      loading: false,
      error: null,
      canViewJobs: true,
    });

    render(<DashboardPage />);
    expect(screen.getByText(/welcome back, eric\./i)).toBeTruthy();
  });

  it("renders the StatStrip ahead of the NewJobsSection in DOM order, with no legacy stat cards or Recent Jobs grid", () => {
    useAuthMock.mockReturnValue({
      profile: { full_name: "Eric Daniels" },
    });
    useDashboardDataMock.mockReturnValue({
      newJobs: [],
      newJobsCount: 2,
      loading: false,
      error: null,
      canViewJobs: true,
    });

    const { container } = render(<DashboardPage />);

    const stripEl = container.querySelector("[data-testid='stat-strip-new-jobs']");
    const sectionCount = container.querySelector("[data-testid='new-jobs-count']");
    expect(stripEl).not.toBeNull();
    expect(sectionCount).not.toBeNull();

    // Order: strip appears before the section.
    const position = stripEl!.compareDocumentPosition(sectionCount!);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(position & 4).toBe(4);

    // Legacy four stat cards are gone — none of their labels appear.
    expect(screen.queryByText("Active Jobs")).toBeNull();
    expect(screen.queryByText("Pending Invoice")).toBeNull();
    expect(screen.queryByText("This Month")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();

    // Legacy "Recent Jobs" grid is gone too.
    expect(screen.queryByText(/recent jobs/i)).toBeNull();
  });

  it("hides the New jobs section AND its stat strip column when the viewer lacks view_jobs", () => {
    useAuthMock.mockReturnValue({
      profile: { full_name: "Crew Member" },
    });
    useDashboardDataMock.mockReturnValue({
      newJobs: [],
      newJobsCount: 0,
      loading: false,
      error: null,
      canViewJobs: false,
    });

    render(<DashboardPage />);

    // No section header, no count pill, no empty-state copy.
    expect(screen.queryByText(/no new jobs/i)).toBeNull();
    expect(screen.queryByText(/^new jobs$/i)).toBeNull();
    expect(screen.queryByTestId("new-jobs-count")).toBeNull();
    expect(screen.queryByTestId("stat-strip-new-jobs")).toBeNull();
  });
});
