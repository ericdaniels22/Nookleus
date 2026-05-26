import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const startMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
const stopMock = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());

vi.mock("@capacitor-community/camera-preview", () => ({
  CameraPreview: {
    start: (arg: unknown) => startMock(arg),
    stop: () => stopMock(),
  },
}));

// Import after mocks.
import { useCameraLifecycle } from "./use-camera-lifecycle";

describe("useCameraLifecycle", () => {
  beforeEach(() => {
    startMock.mockClear();
    stopMock.mockClear();
  });

  it("starts the preview on mount with the supplied rect and position", async () => {
    const rect = { x: 0, y: 0, width: 390, height: 520 };
    renderHook(() =>
      useCameraLifecycle({ rect, position: "rear", safeAreaTop: 0 }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(
      expect.objectContaining({
        position: "rear",
        x: 0,
        y: 0,
        width: 390,
        height: 520,
        toBack: true,
      }),
    );
  });

  it("stops the preview on unmount", async () => {
    const rect = { x: 0, y: 0, width: 390, height: 520 };
    const { unmount } = renderHook(() =>
      useCameraLifecycle({ rect, position: "rear", safeAreaTop: 0 }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(startMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("restarts the preview when rect changes beyond tolerance", async () => {
    const initial = { x: 0, y: 0, width: 390, height: 520 };
    const { rerender } = renderHook(
      ({ rect }) =>
        useCameraLifecycle({ rect, position: "rear", safeAreaTop: 0 }),
      { initialProps: { rect: initial } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(startMock).toHaveBeenCalledTimes(1);

    const changed = { x: 0, y: 0, width: 660, height: 880 };
    await act(async () => {
      rerender({ rect: changed });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledTimes(2);
    expect(startMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 660, height: 880 }),
    );
  });

  it("calls stop on unmount even if start has not resolved yet", async () => {
    // Simulate slow start that hasn't resolved when unmount fires.
    let resolveStart: (() => void) | null = null;
    startMock.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveStart = () => res();
        }) as Promise<void>,
    );

    const rect = { x: 0, y: 0, width: 390, height: 520 };
    const { unmount } = renderHook(() =>
      useCameraLifecycle({ rect, position: "rear", safeAreaTop: 0 }),
    );

    // start was kicked off but is still pending.
    expect(startMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(stopMock).toHaveBeenCalled();

    // Let the stale start resolve to avoid an unhandled-promise warning.
    const r = resolveStart as (() => void) | null;
    if (r) r();
  });

  it("does not restart when the rect change is within tolerance", async () => {
    const initial = { x: 0, y: 0, width: 390, height: 520 };
    const { rerender } = renderHook(
      ({ rect }) =>
        useCameraLifecycle({ rect, position: "rear", safeAreaTop: 0 }),
      { initialProps: { rect: initial } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    startMock.mockClear();
    stopMock.mockClear();

    // Sub-tolerance change (3px).
    const tiny = { x: 0, y: 0, width: 392, height: 521 };
    await act(async () => {
      rerender({ rect: tiny });
      await Promise.resolve();
    });

    expect(startMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });
});
