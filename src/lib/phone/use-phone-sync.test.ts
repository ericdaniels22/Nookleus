// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// `use-phone-sync` — React hook that subscribes to Supabase realtime
// `phone_messages` INSERT events for the active org and fires a callback.
// The Phone-tab UI uses this to live-update the Conversations list and
// the open thread without a manual refresh.
//
// Mirror of `src/lib/email/use-email-sync.ts` in shape (caller-supplied
// callback, hook returns a `connected` flag), but realtime instead of
// polling. The hook is a thin shell over the Supabase channel — most of
// the logic is unsubscribing on unmount and re-subscribing when the org
// changes.
//
// AC bullet: "Realtime updates via Supabase realtime subscription, hooked
// up through a new use-phone-sync hook"

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePhoneSync } from "./use-phone-sync";

interface FakeChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSupabase() {
  const channels: FakeChannel[] = [];
  const channel = vi.fn((): FakeChannel => {
    const ch: FakeChannel = {
      on: vi.fn(() => ch),
      subscribe: vi.fn(() => ch),
      unsubscribe: vi.fn(),
    };
    channels.push(ch);
    return ch;
  });
  return { channel, channels };
}

describe("usePhoneSync", () => {
  it("subscribes to phone_messages INSERTs for the active org on mount", () => {
    const supabase = fakeSupabase();
    const onNewMessage = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage,
      }),
    );

    expect(supabase.channel).toHaveBeenCalledTimes(1);
    const ch = supabase.channels[0];
    expect(ch.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "phone_messages",
        filter: "organization_id=eq.org-1",
      }),
      expect.any(Function),
    );
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
  });

  it("calls onNewMessage with the inserted row when the realtime payload arrives", () => {
    const supabase = fakeSupabase();
    const onNewMessage = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage,
      }),
    );

    // Pull the handler the hook registered, then simulate Twilio→Supabase
    // delivering a new row.
    const ch = supabase.channels[0];
    const handler = ch.on.mock.calls[0][2] as (payload: {
      new: Record<string, unknown>;
    }) => void;

    act(() => {
      handler({
        new: {
          id: "m-1",
          organization_id: "org-1",
          conversation_id: "conv-1",
          direction: "in",
          body: "Hi",
        },
      });
    });

    expect(onNewMessage).toHaveBeenCalledWith({
      id: "m-1",
      organization_id: "org-1",
      conversation_id: "conv-1",
      direction: "in",
      body: "Hi",
    });
  });

  it("unsubscribes the channel on unmount", () => {
    const supabase = fakeSupabase();
    const { unmount } = renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
      }),
    );

    const ch = supabase.channels[0];
    expect(ch.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(ch.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes when organizationId changes (and unsubscribes the old channel)", () => {
    const supabase = fakeSupabase();
    const { rerender } = renderHook(
      ({ orgId }) =>
        usePhoneSync({
          supabase: supabase as never,
          organizationId: orgId,
          onNewMessage: vi.fn(),
        }),
      { initialProps: { orgId: "org-1" } },
    );

    expect(supabase.channel).toHaveBeenCalledTimes(1);

    rerender({ orgId: "org-2" });
    expect(supabase.channel).toHaveBeenCalledTimes(2);
    // Old channel was unsubscribed.
    expect(supabase.channels[0].unsubscribe).toHaveBeenCalledTimes(1);
    // New channel filter is org-2.
    expect(supabase.channels[1].on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ filter: "organization_id=eq.org-2" }),
      expect.any(Function),
    );
  });

  it("does not subscribe when organizationId is null (no active org yet)", () => {
    const supabase = fakeSupabase();
    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: null,
        onNewMessage: vi.fn(),
      }),
    );
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});

// Slice 7 (#311) — re-tag support. A message tagged to a Job after the fact
// (an untagged Phone-tab message UPDATEd with a job_tag) must surface in the
// Job's Messages section in realtime. That's an UPDATE, not an INSERT, so the
// hook grows an optional `onMessageUpdate` callback that registers a *second*
// subscription. The Phone-tab caller passes none, so its behavior is
// unchanged (no UPDATE subscription at all).
describe("usePhoneSync — onMessageUpdate (re-tag)", () => {
  it("registers a second UPDATE subscription and fires onMessageUpdate with the updated row", () => {
    const supabase = fakeSupabase();
    const onMessageUpdate = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
        onMessageUpdate,
      }),
    );

    const ch = supabase.channels[0];
    // INSERT stays the first .on() (existing callers read calls[0]); UPDATE
    // is the second.
    expect(ch.on.mock.calls[0][1]).toEqual(
      expect.objectContaining({ event: "INSERT" }),
    );
    expect(ch.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "phone_messages",
        filter: "organization_id=eq.org-1",
      }),
      expect.any(Function),
    );

    const updateHandler = ch.on.mock.calls[1][2] as (payload: {
      new: Record<string, unknown>;
    }) => void;
    act(() => {
      updateHandler({
        new: {
          id: "m-9",
          organization_id: "org-1",
          conversation_id: "conv-1",
          direction: "in",
          body: "now tagged",
          job_tag: "job-1",
        },
      });
    });

    expect(onMessageUpdate).toHaveBeenCalledWith({
      id: "m-9",
      organization_id: "org-1",
      conversation_id: "conv-1",
      direction: "in",
      body: "now tagged",
      job_tag: "job-1",
    });
  });

  it("registers no UPDATE subscription when onMessageUpdate is omitted", () => {
    const supabase = fakeSupabase();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
      }),
    );

    const ch = supabase.channels[0];
    // INSERT only — exactly one .on() call, and it's not an UPDATE.
    expect(ch.on).toHaveBeenCalledTimes(1);
    expect(ch.on.mock.calls[0][1]).toEqual(
      expect.objectContaining({ event: "INSERT" }),
    );
  });
});
