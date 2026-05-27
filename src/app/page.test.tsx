import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the hook at the import boundary so the page test doesn't touch
// Supabase. Per the PRD, the hook owns both fetches + the 30s polling.
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

const baseData = {
  newJobs: [],
  newJobsCount: 0,
  unreadResponseThreads: [],
  unreadResponsesCount: 0,
  loading: false,
  error: null,
  canViewJobs: true,
  canViewEmail: true,
};

describe("DashboardPage — action hub", () => {
  beforeEach(() => {
    useDashboardDataMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ profile: { full_name: "Eric Daniels" } });
  });

  it("renders the greeting derived from profile.full_name", () => {
    useDashboardDataMock.mockReturnValue(baseData);
    render(<DashboardPage />);
    expect(screen.getByText(/welcome back, eric\./i)).toBeTruthy();
  });

  it("renders New jobs before People to respond to, with no legacy stat cards or Recent Jobs grid", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      newJobsCount: 2,
      unreadResponsesCount: 3,
    });

    const { container } = render(<DashboardPage />);

    const newJobsHeading = container.querySelector("[data-testid='new-jobs-count']");
    const unreadHeading = container.querySelector("[data-testid='unread-responses-count']");
    expect(newJobsHeading).not.toBeNull();
    expect(unreadHeading).not.toBeNull();

    // Order: New jobs section appears before Responses section.
    const position = newJobsHeading!.compareDocumentPosition(unreadHeading!);
    expect(position & 4).toBe(4); // DOCUMENT_POSITION_FOLLOWING

    // Stat strip ordering: jobs column before responses column.
    const jobsStrip = container.querySelector("[data-testid='stat-strip-new-jobs']");
    const respStrip = container.querySelector("[data-testid='stat-strip-unread-responses']");
    expect(jobsStrip).not.toBeNull();
    expect(respStrip).not.toBeNull();
    const stripPos = jobsStrip!.compareDocumentPosition(respStrip!);
    expect(stripPos & 4).toBe(4);

    // Legacy four stat cards are gone.
    expect(screen.queryByText("Active Jobs")).toBeNull();
    expect(screen.queryByText("Pending Invoice")).toBeNull();
    expect(screen.queryByText("This Month")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();

    // Legacy "Recent Jobs" grid is gone too.
    expect(screen.queryByText(/recent jobs/i)).toBeNull();
  });

  it("hides the New jobs section AND its stat strip column when the viewer lacks view_jobs", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      canViewJobs: false,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/no new jobs/i)).toBeNull();
    expect(screen.queryByText(/^new jobs$/i)).toBeNull();
    expect(screen.queryByTestId("new-jobs-count")).toBeNull();
    expect(screen.queryByTestId("stat-strip-new-jobs")).toBeNull();
  });

  it("hides the Responses section AND its stat strip column when the viewer lacks view_email", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      canViewEmail: false,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/no unread responses/i)).toBeNull();
    expect(screen.queryByText(/^people to respond to$/i)).toBeNull();
    expect(screen.queryByTestId("unread-responses-count")).toBeNull();
    expect(screen.queryByTestId("stat-strip-unread-responses")).toBeNull();
  });

  it("renders both sections (with empty-state copy) when both permissions are present and data is empty", () => {
    useDashboardDataMock.mockReturnValue(baseData);
    render(<DashboardPage />);
    expect(screen.getByText("No new jobs.")).toBeTruthy();
    expect(screen.getByText("No unread responses on shared inboxes.")).toBeTruthy();
  });

  it("renders neither section when the viewer has neither permission", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      canViewJobs: false,
      canViewEmail: false,
    });
    render(<DashboardPage />);
    expect(screen.queryByTestId("new-jobs-count")).toBeNull();
    expect(screen.queryByTestId("unread-responses-count")).toBeNull();
    expect(screen.queryByText(/no new jobs/i)).toBeNull();
    expect(screen.queryByText(/no unread responses/i)).toBeNull();
  });
});
