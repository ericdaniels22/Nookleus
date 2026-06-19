import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OnTheClockBarView } from "./on-the-clock-bar";

afterEach(cleanup);

// issue #701 — the persistent app-wide status bar. Its presentational core
// renders "On <Job> · <elapsed> · Clock out" while On the clock, and nothing
// when the worker is not clocked in.
describe("OnTheClockBarView (#701)", () => {
  it("renders nothing when the worker is not on the clock", () => {
    const { container } = render(
      <OnTheClockBarView session={null} elapsedLabel="" onClockOut={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("names the Job, shows the elapsed time, and offers Clock out", () => {
    render(
      <OnTheClockBarView
        session={{ addressLabel: "Maple St" }}
        elapsedLabel="2h 14m"
        onClockOut={() => {}}
      />,
    );
    expect(screen.getByText(/On Maple St/)).toBeTruthy();
    expect(screen.getByText("2h 14m")).toBeTruthy();
    expect(screen.getByRole("button", { name: /clock out/i })).toBeTruthy();
  });

  it("invokes onClockOut when the Clock out button is tapped", () => {
    const onClockOut = vi.fn();
    render(
      <OnTheClockBarView
        session={{ addressLabel: "Maple St" }}
        elapsedLabel="2h 14m"
        onClockOut={onClockOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clock out/i }));
    expect(onClockOut).toHaveBeenCalledTimes(1);
  });

  it("disables Clock out while a clock-out is in flight", () => {
    const onClockOut = vi.fn();
    render(
      <OnTheClockBarView
        session={{ addressLabel: "Maple St" }}
        elapsedLabel="2h 14m"
        onClockOut={onClockOut}
        busy
      />,
    );
    const button = screen.getByRole("button", { name: /clock out/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
