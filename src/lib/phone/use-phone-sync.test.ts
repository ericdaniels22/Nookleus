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

// Slice 10 (#314) — outbound bridge calling. The Phone-tab thread shows an
// in-flight indicator for an outbound call and must flip it live as the
// status-callback webhook advances the `phone_calls` row (queued → ringing →
// in_progress → completed). That's a `phone_calls` UPDATE; a brand-new call
// (e.g. one this user placed from another device, or an inbound ring) is a
// `phone_calls` INSERT. The hook grows two optional callbacks — `onNewCall`
// (INSERT) and `onCallUpdate` (UPDATE) — that register additional
// subscriptions only when supplied. Callers that pass neither (the Job-page
// section) keep exactly their phone_messages subscriptions.
describe("usePhoneSync — phone_calls (outbound bridge call, #314)", () => {
  function findCall(
    ch: FakeChannel,
    event: "INSERT" | "UPDATE",
  ):
    | [
        unknown,
        Record<string, unknown>,
        (p: { new: Record<string, unknown> }) => void,
      ]
    | undefined {
    return ch.on.mock.calls.find(
      (c) =>
        (c[1] as Record<string, unknown>).table === "phone_calls" &&
        (c[1] as Record<string, unknown>).event === event,
    ) as never;
  }

  it("registers a phone_calls INSERT subscription and fires onNewCall with the row", () => {
    const supabase = fakeSupabase();
    const onNewCall = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
        onNewCall,
      }),
    );

    const ch = supabase.channels[0];
    const reg = findCall(ch, "INSERT");
    expect(reg).toBeDefined();
    expect(reg![1]).toEqual(
      expect.objectContaining({
        event: "INSERT",
        schema: "public",
        table: "phone_calls",
        filter: "organization_id=eq.org-1",
      }),
    );

    act(() => {
      reg![2]({
        new: {
          id: "call-1",
          organization_id: "org-1",
          conversation_id: "conv-1",
          direction: "out",
          status: "queued",
        },
      });
    });
    expect(onNewCall).toHaveBeenCalledWith(
      expect.objectContaining({ id: "call-1", status: "queued" }),
    );
  });

  it("registers a phone_calls UPDATE subscription and fires onCallUpdate with the row", () => {
    const supabase = fakeSupabase();
    const onCallUpdate = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
        onCallUpdate,
      }),
    );

    const ch = supabase.channels[0];
    const reg = findCall(ch, "UPDATE");
    expect(reg).toBeDefined();
    expect(reg![1]).toEqual(
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "phone_calls",
        filter: "organization_id=eq.org-1",
      }),
    );

    act(() => {
      reg![2]({
        new: {
          id: "call-1",
          organization_id: "org-1",
          conversation_id: "conv-1",
          direction: "out",
          status: "completed",
          duration_seconds: 30,
        },
      });
    });
    expect(onCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "call-1", status: "completed" }),
    );
  });

  it("registers no phone_calls subscription when neither call callback is supplied", () => {
    const supabase = fakeSupabase();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
        onMessageUpdate: vi.fn(),
      }),
    );

    const ch = supabase.channels[0];
    const callRegs = ch.on.mock.calls.filter(
      (c) => (c[1] as Record<string, unknown>).table === "phone_calls",
    );
    expect(callRegs).toHaveLength(0);
  });
});

// Slice 9 (#313) — voicemail transcription lands asynchronously: the
// transcription-completed webhook UPDATEs the phone_voicemails row long after
// the call row first rendered. The open thread must flip "Transcribing…" to
// the transcript text in realtime, so the hook grows an optional
// `onVoicemailUpdate` callback that registers a subscription on
// `phone_voicemails` UPDATEs for the active org. Callers that don't want it
// (Job-page Messages) pass none and register no such subscription.
describe("usePhoneSync — onVoicemailUpdate (#313)", () => {
  it("registers a phone_voicemails UPDATE subscription and fires onVoicemailUpdate with the updated row", () => {
    const supabase = fakeSupabase();
    const onVoicemailUpdate = vi.fn();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
        onVoicemailUpdate,
      }),
    );

    const ch = supabase.channels[0];
    expect(ch.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        schema: "public",
        table: "phone_voicemails",
        filter: "organization_id=eq.org-1",
      }),
      expect.any(Function),
    );

    // Find the voicemail-UPDATE handler (not the phone_messages INSERT) and
    // simulate the transcription-completed webhook's UPDATE arriving.
    const vmCall = ch.on.mock.calls.find(
      (c) =>
        (c[1] as { table?: string }).table === "phone_voicemails" &&
        (c[1] as { event?: string }).event === "UPDATE",
    );
    expect(vmCall).toBeDefined();
    const handler = vmCall![2] as (payload: {
      new: Record<string, unknown>;
    }) => void;

    act(() => {
      handler({
        new: {
          id: "vm-1",
          organization_id: "org-1",
          phone_call_id: "call-1",
          audio_storage_path: "org-1/rec-1.mp3",
          transcript: "Call me back.",
          transcript_status: "ready",
          duration_seconds: 12,
        },
      });
    });

    expect(onVoicemailUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "vm-1",
        phone_call_id: "call-1",
        transcript: "Call me back.",
        transcript_status: "ready",
      }),
    );
  });

  it("registers no phone_voicemails subscription when onVoicemailUpdate is omitted", () => {
    const supabase = fakeSupabase();

    renderHook(() =>
      usePhoneSync({
        supabase: supabase as never,
        organizationId: "org-1",
        onNewMessage: vi.fn(),
      }),
    );

    const ch = supabase.channels[0];
    const vmCall = ch.on.mock.calls.find(
      (c) => (c[1] as { table?: string }).table === "phone_voicemails",
    );
    expect(vmCall).toBeUndefined();
  });
});
