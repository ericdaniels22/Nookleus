// OnSiteNow container — wires the realtime roster, scoped to one Job, into the
// pure OnSiteNowView (#705, epic #699). It carries no permission gate of its
// own: it rides surfaces already gated by view_jobs (the Job page and card).
// Its job is to scope the hook to this Job and project sessions down to names.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const useOpenSessionsMock = vi.fn();
vi.mock("@/lib/timesheets/use-open-sessions", () => ({
  useOpenSessions: (input: unknown) => useOpenSessionsMock(input),
}));

vi.mock("@/lib/supabase", () => ({ createClient: () => ({ __fake: true }) }));

import OnSiteNow from "./on-site-now";

beforeEach(() => {
  vi.clearAllMocks();
  useOpenSessionsMock.mockReturnValue({ sessions: [], loading: false });
});
afterEach(cleanup);

function presence(over: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    userId: "u1",
    jobId: "job-7",
    startedAt: "2026-06-27T14:00:00.000Z",
    workerName: "Jordan Rivera",
    job: { jobNumber: "J-100", propertyAddress: "12 Oak St" },
    ...over,
  };
}

describe("OnSiteNow (container, #705)", () => {
  it("scopes the roster to this Job and names the app Users on site", () => {
    useOpenSessionsMock.mockReturnValue({
      sessions: [presence(), presence({ sessionId: "s2", userId: "u2", workerName: "Sam Diaz" })],
      loading: false,
    });

    render(<OnSiteNow organizationId="org-1" jobId="job-7" />);

    expect(useOpenSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", jobId: "job-7" }),
    );
    expect(screen.getByText(/on site now/i)).toBeTruthy();
    expect(screen.getByText(/Jordan Rivera/)).toBeTruthy();
    expect(screen.getByText(/Sam Diaz/)).toBeTruthy();
  });
});
