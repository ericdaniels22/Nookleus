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

  it("applies rubber-band resistance to the reveal during a drag (stiffer the further you pull)", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    const child = screen.getByTestId("child");
    const rowHeight = () =>
      parseFloat(
        (container.querySelector(".animate-spin")?.parentElement as HTMLElement)
          .style.height,
      );

    // Begin a drag from the top and read the revealed spinner-row height at two
    // depths along the same continuous pull, holding the finger down (no
    // release) so the reveal stays put between reads.
    await act(async () => {
      fireEvent.touchStart(child, { touches: [{ clientY: 100 }] });
      fireEvent.touchMove(child, { touches: [{ clientY: 140 }] }); // +40px
    });
    const at40 = rowHeight();

    await act(async () => {
      fireEvent.touchMove(child, { touches: [{ clientY: 180 }] }); // +80px
    });
    const at80 = rowHeight();

    // The row tracks the finger from the start (some reveal early)...
    expect(at40).toBeGreaterThan(0);
    // ...keeps opening as you pull further...
    expect(at80).toBeGreaterThan(at40);
    // ...but with resistance: the second 40px of pull reveals less than the
    // first 40px did. A linear mapping would reveal exactly as much, so this
    // pins the non-linear rubber-band curve (#677).
    expect(at80 - at40).toBeLessThan(at40);
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
    vi.useFakeTimers();
    try {
      useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
      const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
      const { container } = render(
        <PullToRefresh onRefresh={onRefresh}>
          <div data-testid="child">job</div>
        </PullToRefresh>,
      );
      await act(async () => {});

      await pullDown(screen.getByTestId("child"));

      // The spinner holds briefly (min-spin, #677), but it is not stuck: once
      // the minimum elapses the row collapses back to hidden.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      const spinnerRow = container.querySelector(".animate-spin")?.parentElement;
      expect(spinnerRow?.getAttribute("aria-hidden")).toBe("true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries on a subsequent pull after a failure", async () => {
    vi.useFakeTimers();
    try {
      useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
      const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
      render(
        <PullToRefresh onRefresh={onRefresh}>
          <div data-testid="child">job</div>
        </PullToRefresh>,
      );
      await act(async () => {});

      await pullDown(screen.getByTestId("child"));
      // Let the first attempt's spinner settle (min-spin, #677) so the gesture
      // re-arms before a fresh pull retries.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      await pullDown(screen.getByTestId("child"));

      expect(onRefresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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

  it("contains the document's vertical overscroll on the native app so the custom pull and WKWebView bounce don't fight", async () => {
    useCapacitorMock.mockReturnValue({ isNative: true, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    // While mounted, the document stops its own vertical rubber-band so the
    // WKWebView bounce doesn't visibly fight the in-app pull; the spinner owns
    // the overscroll (#677).
    expect(
      document.documentElement.style.getPropertyValue("overscroll-behavior-y"),
    ).toBe("contain");

    // ...and it's released on unmount — no lingering global side effect.
    await act(async () => {
      unmount();
    });
    expect(
      document.documentElement.style.getPropertyValue("overscroll-behavior-y"),
    ).toBe("");
  });

  it("leaves the document's overscroll untouched off-native (browser pull-to-refresh stands)", async () => {
    useCapacitorMock.mockReturnValue({ isNative: false, ready: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="child">job</div>
      </PullToRefresh>,
    );
    await act(async () => {});

    // Mobile Safari and the home-screen PWA keep the browser's own
    // pull-to-refresh, so the wrapper must not clamp the document there (#677).
    expect(
      document.documentElement.style.getPropertyValue("overscroll-behavior-y"),
    ).toBe("");
  });
});
