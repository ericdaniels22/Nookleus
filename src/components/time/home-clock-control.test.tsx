import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Isolate the control: stub the context so we drive canTrackTime/active, and
// stub the picker (it pulls in a dialog + Job data we don't own here).
const useOnTheClockMock = vi.fn();
vi.mock("@/lib/on-the-clock-context", () => ({
  useOnTheClock: () => useOnTheClockMock(),
}));
vi.mock("@/components/time/clock-in-picker", () => ({
  default: () => null,
}));

import HomeClockControl from "./home-clock-control";

describe("<HomeClockControl>", () => {
  beforeEach(() => {
    useOnTheClockMock.mockReset();
  });

  it("renders nothing for a worker without track_time", () => {
    useOnTheClockMock.mockReturnValue({ canTrackTime: false, active: null });
    const { container } = render(<HomeClockControl />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a clock-in action that is NOT the solid primary (§2.4: the one solid emerald is reserved for the page header)", () => {
    useOnTheClockMock.mockReturnValue({ canTrackTime: true, active: null });
    render(<HomeClockControl />);

    const btn = screen.getByRole("button", { name: /clock in to a job/i });
    expect(btn).toBeTruthy();
    // Demoted to the accent-tint treatment — no solid emerald fill.
    expect(btn.className).not.toContain("text-primary-foreground");
    expect(btn.className).toContain("text-accent-text");
  });

  it("reflects the on-the-clock state without offering a clock-in button", () => {
    useOnTheClockMock.mockReturnValue({
      canTrackTime: true,
      active: { job: { property_address: "123 Main St" } },
    });
    render(<HomeClockControl />);

    expect(
      screen.queryByRole("button", { name: /clock in to a job/i }),
    ).toBeNull();
    expect(screen.getByText(/on the clock/i)).toBeTruthy();
  });
});
