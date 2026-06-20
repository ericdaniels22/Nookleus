import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const useCapacitorMock = vi.fn();
vi.mock("@/lib/mobile/use-capacitor", () => ({
  useCapacitor: () => useCapacitorMock(),
}));

// Import after the mock is registered.
import { PullToRefresh } from "./pull-to-refresh";

afterEach(() => cleanup());

describe("PullToRefresh", () => {
  it("renders children as a plain passthrough when not on the native app", async () => {
    useCapacitorMock.mockReturnValue({ isNative: false, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    expect(screen.getByTestId("child")).toBeTruthy();
    // No spinner chrome off-native — the browser's own pull-to-refresh stands.
    expect(container.querySelector(".animate-spin")).toBeNull();

    // And a pull is inert.
    await act(async () => {
      fireEvent.touchStart(screen.getByTestId("child"), { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(screen.getByTestId("child"), { touches: [{ clientY: 220 }] });
      fireEvent.touchEnd(screen.getByTestId("child"), { changedTouches: [{ clientY: 220 }] });
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("runs onRefresh on a downward pull past the threshold on the native app", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.touchStart(screen.getByTestId("child"), { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(screen.getByTestId("child"), { touches: [{ clientY: 200 }] });
      fireEvent.touchEnd(screen.getByTestId("child"), { changedTouches: [{ clientY: 200 }] });
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
