import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCaptureMode } from "./use-capture-mode";

// Build a simple in-memory localStorage stub that supports .clear()
function makeLocalStorageStub() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
}

describe("useCaptureMode", () => {
  let localStorageStub: ReturnType<typeof makeLocalStorageStub>;

  beforeEach(() => {
    localStorageStub = makeLocalStorageStub();
    Object.defineProperty(window, "localStorage", {
      value: localStorageStub,
      writable: true,
      configurable: true,
    });
  });

  it("defaults to 'tag-after' when no stored value", () => {
    const { result } = renderHook(() => useCaptureMode());
    const [mode] = result.current;
    expect(mode).toBe("tag-after");
  });

  it("restores stored value over default", async () => {
    localStorageStub.setItem("mobile-capture-mode", "rapid");
    const { result, rerender } = renderHook(() => useCaptureMode());
    // useEffect runs after mount; trigger a rerender to let effects flush
    rerender();
    const [mode] = result.current;
    expect(mode).toBe("rapid");
  });

  it("persists set mode to localStorage", () => {
    const { result } = renderHook(() => useCaptureMode());
    act(() => {
      const [, setMode] = result.current;
      setMode("rapid");
    });
    expect(localStorageStub.setItem).toHaveBeenCalledWith(
      "mobile-capture-mode",
      "rapid"
    );
  });
});
