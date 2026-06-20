import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const useCapacitorMock = vi.fn();
vi.mock("@/lib/mobile/use-capacitor", () => ({
  useCapacitor: () => useCapacitorMock(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Import after the mocks are registered.
import { PullToRefresh } from "./pull-to-refresh";
import { toast } from "sonner";

// Fire one downward pull (start → move → release) past the threshold on `el`.
async function pullDown(el: HTMLElement) {
  await act(async () => {
    fireEvent.touchStart(el, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: 200 }] });
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it("keeps children on screen and shows a failure toast when onRefresh fails", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    await pullDown(screen.getByTestId("child"));

    // Existing data stays put — nothing blanks or collapses on a failed reload.
    expect(screen.getByTestId("child")).toBeTruthy();
    // ...and a brief, clear failure message is surfaced via sonner.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't refresh — check your connection.",
    );
  });

  it("retracts the spinner after a failed refresh (no stuck spinner)", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    await pullDown(screen.getByTestId("child"));

    // Once the failure settles, the spinner row collapses back to hidden.
    const spinnerRow = container.querySelector(".animate-spin")?.parentElement;
    expect(spinnerRow?.getAttribute("aria-hidden")).toBe("true");
  });

  it("retries on a subsequent pull after a failure", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    await pullDown(screen.getByTestId("child"));
    await pullDown(screen.getByTestId("child"));

    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("stands down on the native app while disabled (an overlay is open)", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh} disabled>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    // A full downward pull past the threshold is inert: the overlay on top
    // gets the gesture, the job underneath does not refresh (#678).
    await pullDown(screen.getByTestId("child"));

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
