// OnTheClockNow container — the wiring around the pure view (#705, epic #699).
// It reads auth, gates on the NEW view_timesheets permission, and feeds the
// realtime roster + a ticking `now` into OnTheClockNowView.
//
// The gate is the load-bearing behavior here (#705 AC: the panel is absent for
// crew_member). Because the org-wide roster is only fetched when permitted —
// the hook is handed organizationId: null otherwise — a worker without the
// permission triggers NO realtime subscription, not just a hidden panel.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const hasPermission = vi.fn();
const authState: { organizationId: string | null } = { organizationId: "org-1" };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ hasPermission, organizationId: authState.organizationId }),
}));

const useOpenSessionsMock = vi.fn();
vi.mock("@/lib/timesheets/use-open-sessions", () => ({
  useOpenSessions: (input: unknown) => useOpenSessionsMock(input),
}));

vi.mock("@/lib/supabase", () => ({ createClient: () => ({ __fake: true }) }));

// The empty state offers an inline clock-in CTA (#913) — but only to a viewer
// who can actually clock in. Stub the context that gates that, and the picker
// the CTA opens.
const useOnTheClockMock = vi.fn();
vi.mock("@/lib/on-the-clock-context", () => ({
  useOnTheClock: () => useOnTheClockMock(),
}));
vi.mock("@/components/time/clock-in-picker", () => ({
  default: () => null,
}));

import OnTheClockNow from "./on-the-clock-now";

beforeEach(() => {
  vi.clearAllMocks();
  authState.organizationId = "org-1";
  useOpenSessionsMock.mockReturnValue({ sessions: [], loading: false });
  useOnTheClockMock.mockReturnValue({ canTrackTime: false });
});
afterEach(cleanup);

describe("OnTheClockNow (container, #705)", () => {
  it("is absent — and holds no subscription — for a worker without view_timesheets", () => {
    hasPermission.mockReturnValue(false);

    const { container } = render(<OnTheClockNow />);

    expect(hasPermission).toHaveBeenCalledWith("view_timesheets");
    expect(container.firstChild).toBeNull();
    // The hook still runs (rules of hooks) but with a null org, so it opens no
    // realtime channel and fetches nothing for an unauthorized worker.
    expect(useOpenSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null }),
    );
  });

  it("shows the org-wide roster, scoped to the active Org, for an authorized user", () => {
    hasPermission.mockReturnValue(true);
    authState.organizationId = "org-7";
    useOpenSessionsMock.mockReturnValue({
      sessions: [
        {
          sessionId: "s1",
          userId: "u1",
          jobId: "j1",
          startedAt: "2026-06-27T14:00:00.000Z",
          workerName: "Jordan Rivera",
          job: { jobNumber: "J-100", propertyAddress: "12 Oak St" },
        },
      ],
      loading: false,
    });

    render(<OnTheClockNow />);

    expect(screen.getByText(/on the clock now/i)).toBeTruthy();
    expect(screen.getByText("Jordan Rivera")).toBeTruthy();
    // No Job to source the org from — it comes from auth, and only the active
    // Org's roster is ever requested.
    expect(useOpenSessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-7" }),
    );
  });

  it("offers an inline clock-in CTA in the empty state when the viewer can track time", () => {
    hasPermission.mockReturnValue(true);
    useOpenSessionsMock.mockReturnValue({ sessions: [], loading: false });
    useOnTheClockMock.mockReturnValue({ canTrackTime: true });

    render(<OnTheClockNow />);

    expect(screen.getByText("No one's on the clock")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /clock in to a job/i }),
    ).toBeTruthy();
  });

  it("omits the inline clock-in CTA for a viewer who cannot clock in", () => {
    hasPermission.mockReturnValue(true);
    useOpenSessionsMock.mockReturnValue({ sessions: [], loading: false });
    useOnTheClockMock.mockReturnValue({ canTrackTime: false });

    render(<OnTheClockNow />);

    expect(screen.getByText("No one's on the clock")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /clock in to a job/i }),
    ).toBeNull();
  });
});
