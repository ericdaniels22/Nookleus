import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEmailSync } from "./use-email-sync";

describe("useEmailSync", () => {
  it("does not auto-sync when latest sync is within the debounce window", async () => {
    const doSync = vi.fn(async () => undefined);
    const recent = new Date(Date.now() - 30_000).toISOString();
    await act(async () => {
      renderHook(() =>
        useEmailSync({
          accounts: [{ id: "acc-1", last_synced_at: recent }],
          selectedAccountId: "acc-1",
          doSync,
        }),
      );
    });
    expect(doSync).not.toHaveBeenCalled();
  });

  it("auto-fires a silent sync when last_synced_at is older than the debounce", async () => {
    const doSync = vi.fn(async () => undefined);
    const old = new Date(Date.now() - 120_000).toISOString();
    let hookResult: ReturnType<typeof renderHook<unknown, unknown>> | null = null;
    await act(async () => {
      hookResult = renderHook(() =>
        useEmailSync({
          accounts: [{ id: "acc-1", last_synced_at: old }],
          selectedAccountId: "acc-1",
          doSync,
        }),
      );
    });
    expect(doSync).toHaveBeenCalledTimes(1);
    // Silent fire — never flips the visible spinner.
    expect((hookResult as unknown as { result: { current: { syncing: boolean } } }).result.current.syncing).toBe(false);
  });

  it("syncVisible() fires when nothing is in flight, toggling syncing on/off", async () => {
    let resolveDoSync: () => void = () => undefined;
    const doSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDoSync = resolve;
        }),
    );
    const recent = new Date().toISOString();
    const { result } = renderHook(() =>
      useEmailSync({
        accounts: [{ id: "acc-1", last_synced_at: recent }],
        selectedAccountId: "acc-1",
        doSync,
      }),
    );
    await act(async () => undefined);
    expect(result.current.syncing).toBe(false);

    let visiblePromise: Promise<void> | undefined;
    act(() => {
      visiblePromise = result.current.syncVisible();
    });
    expect(result.current.syncing).toBe(true);
    expect(doSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDoSync();
      await visiblePromise;
    });
    expect(result.current.syncing).toBe(false);
  });

  it("syncVisible() promotes an in-flight silent sync without firing a second request", async () => {
    let resolveDoSync: () => void = () => undefined;
    const doSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDoSync = resolve;
        }),
    );
    // Stale last_synced_at => auto-sync fires the silent sync on mount.
    const stale = new Date(Date.now() - 120_000).toISOString();
    const { result } = renderHook(() =>
      useEmailSync({
        accounts: [{ id: "acc-1", last_synced_at: stale }],
        selectedAccountId: "acc-1",
        doSync,
      }),
    );
    await act(async () => undefined);
    expect(doSync).toHaveBeenCalledTimes(1); // silent fired

    let visiblePromise: Promise<void> | undefined;
    act(() => {
      visiblePromise = result.current.syncVisible();
    });
    expect(result.current.syncing).toBe(true);
    expect(doSync).toHaveBeenCalledTimes(1); // NOT 2 — promoted, not duplicated

    await act(async () => {
      resolveDoSync();
      await visiblePromise;
    });
    expect(result.current.syncing).toBe(false);
    expect(doSync).toHaveBeenCalledTimes(1);
  });

  it("flags syncFailed when a silent sync rejects, without toggling syncing", async () => {
    const doSync = vi.fn(async () => {
      throw new Error("network down");
    });
    const stale = new Date(Date.now() - 120_000).toISOString();
    const { result } = renderHook(() =>
      useEmailSync({
        accounts: [{ id: "acc-1", last_synced_at: stale }],
        selectedAccountId: "acc-1",
        doSync,
      }),
    );
    await act(async () => undefined);
    expect(doSync).toHaveBeenCalledTimes(1);
    expect(result.current.syncing).toBe(false);
    expect(result.current.syncFailed).toBe(true);
  });

  it("advances lastSyncedAt after a successful sync", async () => {
    const doSync = vi.fn(async () => undefined);
    const old = new Date("2026-05-13T08:00:00.000Z").toISOString();
    const { result } = renderHook(() =>
      useEmailSync({
        accounts: [{ id: "acc-1", last_synced_at: old }],
        selectedAccountId: "acc-1",
        doSync,
        autoSync: false,
      }),
    );
    const before = result.current.lastSyncedAt;
    expect(before?.toISOString()).toBe(old);

    await act(async () => {
      await result.current.syncVisible();
    });

    const after = result.current.lastSyncedAt;
    expect(after).not.toBeNull();
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });
});
