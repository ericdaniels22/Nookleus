import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

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

// The clock-in control and presence panel are separately tested and pull in
// realtime/context providers the dashboard composition test doesn't own — stub
// them so this test stays focused on the KPI row + widget grid.
vi.mock("@/components/time/home-clock-control", () => ({
  default: () => null,
}));
vi.mock("@/components/time/on-the-clock-now", () => ({
  default: () => null,
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

  it("puts a single primary action — New intake → /intake — in the page header", () => {
    useDashboardDataMock.mockReturnValue(baseData);
    render(<DashboardPage />);
    const cta = screen.getByRole("link", { name: /new intake/i });
    expect(cta.getAttribute("href")).toBe("/intake");
  });

  it("renders a KPI metric row: New jobs → /jobs and Unread responses → /email", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      newJobsCount: 2,
      unreadResponsesCount: 3,
    });
    const { container } = render(<DashboardPage />);
    const row = container.querySelector('[data-testid="kpi-row"]') as HTMLElement;
    expect(row).not.toBeNull();

    const jobsCard = within(row).getByText("New jobs").closest("a");
    const respCard = within(row).getByText("Unread responses").closest("a");
    expect(jobsCard?.getAttribute("href")).toBe("/jobs");
    expect(respCard?.getAttribute("href")).toBe("/email");

    // The counts are reflected on the KPI cards.
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(row).getByText("3")).toBeTruthy();
  });

  it("renders KPI value skeletons (not the counts) while loading", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      loading: true,
      newJobsCount: 2,
      unreadResponsesCount: 3,
    });
    const { container } = render(<DashboardPage />);
    const row = container.querySelector('[data-testid="kpi-row"]') as HTMLElement;
    expect(row.querySelector('[data-slot="skeleton"]')).not.toBeNull();
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

    // Legacy four stat cards are gone.
    expect(screen.queryByText("Active Jobs")).toBeNull();
    expect(screen.queryByText("Pending Invoice")).toBeNull();
    expect(screen.queryByText("This Month")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();

    // Legacy "Recent Jobs" grid is gone too.
    expect(screen.queryByText(/recent jobs/i)).toBeNull();
  });

  it("drops the dashboard entrance animation (§5 motion)", () => {
    useDashboardDataMock.mockReturnValue(baseData);
    const { container } = render(<DashboardPage />);
    expect((container.firstChild as HTMLElement).className).not.toContain("animate-");
  });

  it("hides the New jobs KPI card AND section when the viewer lacks view_jobs", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      canViewJobs: false,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/^new jobs$/i)).toBeNull();
    expect(screen.queryByTestId("new-jobs-count")).toBeNull();
  });

  it("hides the Unread responses KPI card AND section when the viewer lacks view_email", () => {
    useDashboardDataMock.mockReturnValue({
      ...baseData,
      canViewEmail: false,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/^unread responses$/i)).toBeNull();
    expect(screen.queryByTestId("unread-responses-count")).toBeNull();
    expect(screen.queryByText(/^people to respond to$/i)).toBeNull();
  });

  it("renders both sections' empty states when both permissions are present and data is empty", () => {
    useDashboardDataMock.mockReturnValue(baseData);
    render(<DashboardPage />);
    expect(screen.getByText("No new jobs")).toBeTruthy();
    expect(screen.getByText("You're all caught up")).toBeTruthy();
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
    expect(screen.queryByText(/you're all caught up/i)).toBeNull();
  });
});
