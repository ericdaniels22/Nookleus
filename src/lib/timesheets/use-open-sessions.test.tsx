// use-open-sessions — the realtime Presence hook (#705, epic #699).
//
// It owns a LIVE list of who is On the clock (for an Org, optionally one Job)
// and keeps it current by RE-HYDRATING — re-running loadOpenSessions — on every
// relevant `time_sessions` event. That refetch-on-event shape is the key
// difference from usePhoneSync (which only forwards the payload): a clock-in
// (INSERT) or clock-out / re-assign (UPDATE) anywhere in the Org invalidates the
// roster, so the hook reloads the authoritative list rather than trying to
// patch it from a single row.
//
// The query itself (org/Job scope, off-app exclusion) is the loader's contract,
// covered in load-open-sessions.test.ts; here loadOpenSessions is mocked so the
// tests pin the hook's OWN behavior: subscription wiring, per-mount-unique
// channel topic, refetch-on-event, and teardown.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("./load-open-sessions", () => ({ loadOpenSessions: vi.fn() }));

import { useOpenSessions } from "./use-open-sessions";
import { loadOpenSessions } from "./load-open-sessions";
import type { OpenSessionPresence } from "./load-open-sessions";

const mockLoad = vi.mocked(loadOpenSessions);

interface FakeChannel {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSupabase() {
  const channels: FakeChannel[] = [];
  const channel = vi.fn((topic: string): FakeChannel => {
    const ch: FakeChannel = {
      topic,
      on: vi.fn(() => ch),
      subscribe: vi.fn(() => ch),
      unsubscribe: vi.fn(),
    };
    channels.push(ch);
    return ch;
  });
  return { channel, channels };
}

function session(over: Partial<OpenSessionPresence> = {}): OpenSessionPresence {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    jobId: "job-1",
    startedAt: "2026-06-27T14:00:00.000Z",
    workerName: "Jordan Rivera",
    job: { jobNumber: "J-100", propertyAddress: "12 Oak St" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue([]);
});

describe("useOpenSessions", () => {
  it("subscribes to time_sessions INSERTs for the active Org and exposes the initial roster", async () => {
    const supabase = fakeSupabase();
    mockLoad.mockResolvedValue([session()]);

    const { result } = renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );

    // One channel, an INSERT binding on time_sessions scoped to the Org, subscribed.
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    const ch = supabase.channels[0];
    expect(ch.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "time_sessions",
        filter: "organization_id=eq.org-1",
      }),
      expect.any(Function),
    );
    expect(ch.subscribe).toHaveBeenCalledTimes(1);

    // The initial load hydrates the list.
    await waitFor(() => {
      expect(result.current.sessions).toEqual([session()]);
    });
    expect(result.current.loading).toBe(false);
  });

  it("also subscribes to time_sessions UPDATEs (clock-out / Job re-assign)", async () => {
    const supabase = fakeSupabase();

    renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );

    const ch = supabase.channels[0];
    expect(ch.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "time_sessions",
        filter: "organization_id=eq.org-1",
      }),
      expect.any(Function),
    );
  });

  it("RE-HYDRATES the roster when a realtime event fires (refetch-on-event)", async () => {
    const supabase = fakeSupabase();
    const before = [session({ sessionId: "a", userId: "user-1" })];
    const after = [
      session({ sessionId: "a", userId: "user-1" }),
      session({ sessionId: "b", userId: "user-2", workerName: "Sam Diaz" }),
    ];
    mockLoad.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

    const { result } = renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );

    await waitFor(() => expect(result.current.sessions).toEqual(before));
    expect(mockLoad).toHaveBeenCalledTimes(1);

    // A new clock-in arrives — invoke the registered INSERT handler.
    const ch = supabase.channels[0];
    const insertHandler = ch.on.mock.calls[0][2] as (p: {
      new: Record<string, unknown>;
    }) => void;
    await act(async () => {
      insertHandler({ new: { id: "b", organization_id: "org-1" } });
    });

    // The hook reloaded the authoritative list rather than patching from the row.
    await waitFor(() => expect(result.current.sessions).toEqual(after));
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it("scopes the loader to one Job when jobId is given (per-Job 'On site now')", async () => {
    const supabase = fakeSupabase();

    renderHook(() =>
      useOpenSessions({
        supabase: supabase as never,
        organizationId: "org-1",
        jobId: "job-7",
      }),
    );

    await waitFor(() => expect(mockLoad).toHaveBeenCalled());
    expect(mockLoad).toHaveBeenCalledWith(supabase, {
      organizationId: "org-1",
      jobId: "job-7",
    });
  });

  it("unsubscribes the channel on unmount", async () => {
    const supabase = fakeSupabase();
    const { unmount } = renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );

    const ch = supabase.channels[0];
    expect(ch.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(ch.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("holds no subscription and reports an empty roster when there is no active Org", () => {
    const supabase = fakeSupabase();
    const { result } = renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: null }),
    );

    expect(supabase.channel).not.toHaveBeenCalled();
    expect(mockLoad).not.toHaveBeenCalled();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("gives each mount a distinct channel topic (RealtimeClient dedupe guard)", () => {
    const supabase = fakeSupabase();
    renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );
    renderHook(() =>
      useOpenSessions({ supabase: supabase as never, organizationId: "org-1" }),
    );

    expect(supabase.channels).toHaveLength(2);
    expect(supabase.channels[0].topic).not.toBe(supabase.channels[1].topic);
  });
});
