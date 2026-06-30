// Unit tests for useDebouncedSave (issue #806) — the reusable debounced-save
// primitive the Photo viewer (and later the annotator) build on. Mirrors
// estimate-builder/use-auto-save.flush-on-unmount.test.tsx: a render harness
// with fake timers and a mocked transport edits within the debounce window,
// then unmounts — asserting the pending write flushes to the transport instead
// of being silently dropped. Also covers silent success (no error surfaced) and
// a persistent failure surfacing the warning after retries.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect, useRef } from "react";

import { useDebouncedSave, type UseDebouncedSaveOptions } from "./use-debounced-save";

// Minimal harness: drives the real hook off a `value` prop. Re-rendering with a
// new value simulates an in-app edit (each change schedules a save whose thunk
// closes over the latest value); unmounting simulates navigating away.
function Harness({
  value,
  options,
  transport,
}: {
  value: string;
  options: UseDebouncedSaveOptions;
  transport: (value: string) => Promise<void>;
}) {
  const saver = useDebouncedSave(options);
  const first = useRef(true);
  useEffect(() => {
    // Skip the initial mount so an untouched harness schedules nothing.
    if (first.current) {
      first.current = false;
      return;
    }
    saver.save(() => transport(value));
    // Only re-schedule when the edited value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDebouncedSave flush-on-unmount (#806)", () => {
  it("flushes a pending save to the transport on unmount", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const { rerender, unmount } = render(
      <Harness value="a" options={{ delay: 2000 }} transport={transport} />,
    );

    // Edit within the 2s debounce window — scheduled, but the timer hasn't fired.
    rerender(<Harness value="b" options={{ delay: 2000 }} transport={transport} />);
    expect(transport).not.toHaveBeenCalled();

    // Navigate away before the debounce elapses.
    await act(async () => {
      unmount();
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("b");
  });

  it("coalesces rapid edits within the window into a single write of the latest value", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <Harness value="a" options={{ delay: 2000 }} transport={transport} />,
    );

    // Three keystrokes in quick succession, all inside the debounce window.
    rerender(<Harness value="ab" options={{ delay: 2000 }} transport={transport} />);
    rerender(<Harness value="abc" options={{ delay: 2000 }} transport={transport} />);
    rerender(<Harness value="abcd" options={{ delay: 2000 }} transport={transport} />);
    expect(transport).not.toHaveBeenCalled();

    // Let the quiet window elapse.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Exactly one write, of the final value — not one per keystroke.
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("abcd");
  });

  it("retries a failing write and surfaces the warning only after retries are exhausted", async () => {
    const onError = vi.fn();
    const transport = vi.fn(() => Promise.reject(new Error("network down")));
    const { rerender } = render(
      <Harness
        value="a"
        options={{ delay: 2000, maxAttempts: 3, onError }}
        transport={transport}
      />,
    );

    rerender(
      <Harness
        value="b"
        options={{ delay: 2000, maxAttempts: 3, onError }}
        transport={transport}
      />,
    );

    // Run the debounce window and every backoff retry to completion.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // 3 attempts total (initial + 2 retries), then exactly one warning.
    expect(transport).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("is silent on a successful save — no warning is surfaced", async () => {
    const onError = vi.fn();
    const transport = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <Harness value="a" options={{ delay: 2000, onError }} transport={transport} />,
    );

    rerender(
      <Harness value="b" options={{ delay: 2000, onError }} transport={transport} />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not surface a warning when a save fails once then succeeds on retry", async () => {
    const onError = vi.fn();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness
        value="a"
        options={{ delay: 2000, maxAttempts: 3, onError }}
        transport={transport}
      />,
    );

    rerender(
      <Harness
        value="b"
        options={{ delay: 2000, maxAttempts: 3, onError }}
        transport={transport}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // One failure, one successful retry, and no warning.
    expect(transport).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("saves immediately with no debounce wait when delay is 0", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const { rerender } = render(
      <Harness value="a" options={{ delay: 0 }} transport={transport} />,
    );

    // A delay-0 saver (tags / Before-After) persists on change with no wait.
    await act(async () => {
      rerender(<Harness value="b" options={{ delay: 0 }} transport={transport} />);
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("b");
  });
});

// Hard unload / app-backgrounding: a real tab-close or iOS background does NOT
// run React cleanup, so the unmount flush never fires. The hook also listens for
// the browser page-lifecycle events and flushes a pending save on them.
describe("useDebouncedSave flush-on-hard-unload (#806)", () => {
  it("flushes a pending save on a pagehide event while still mounted", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const { rerender, unmount } = render(
      <Harness value="a" options={{ delay: 2000 }} transport={transport} />,
    );

    rerender(<Harness value="b" options={{ delay: 2000 }} transport={transport} />);
    expect(transport).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("b");

    act(() => {
      unmount();
    });
  });

  it("flushes on visibilitychange when the page becomes hidden, but not when visible", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const setVisibility = (state: DocumentVisibilityState) =>
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });

    const { rerender, unmount } = render(
      <Harness value="a" options={{ delay: 2000 }} transport={transport} />,
    );
    rerender(<Harness value="b" options={{ delay: 2000 }} transport={transport} />);

    // Returning to the foreground is not a teardown — no flush.
    await act(async () => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(transport).not.toHaveBeenCalled();

    // Backgrounding the tab/app flushes the pending edit.
    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith("b");

    setVisibility("visible");
    act(() => {
      unmount();
    });
  });

  it("removes its listeners on unmount — a later pagehide fires no further save", async () => {
    const transport = vi.fn(() => Promise.resolve());
    const { rerender, unmount } = render(
      <Harness value="a" options={{ delay: 2000 }} transport={transport} />,
    );
    rerender(<Harness value="b" options={{ delay: 2000 }} transport={transport} />);

    // Unmount flushes once via the #806 cleanup.
    act(() => {
      unmount();
    });
    expect(transport).toHaveBeenCalledTimes(1);

    // Listeners must be gone — a stray pagehide must not fire a second save.
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
