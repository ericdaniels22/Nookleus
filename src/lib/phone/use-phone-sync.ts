"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// PRD #304 — Nookleus Phone. Slice 4 (#308).
//
// Subscribe to Supabase realtime `phone_messages` INSERT events for the
// active org and fire `onNewMessage` for each. The Phone-tab UI uses this
// to live-update the Conversations list and the open thread.
//
// Mirror of `src/lib/email/use-email-sync.ts` in shape but realtime
// instead of polling. The hook itself is a thin wrapper around the
// Supabase channel; the org filter (`organization_id=eq.<id>`) is
// applied server-side so we never receive events for other orgs even
// if the page somehow had a stale subscription.

interface PhoneMessageRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  body: string | null;
  job_tag: string | null;
  sent_at: string;
  [key: string]: unknown;
}

// Slice 10 (#314) — a phone_calls row as it arrives over realtime. The
// status-callback webhook UPDATEs status / duration_seconds / ended_at as
// Twilio advances the call; a fresh call (placed elsewhere, or inbound) is
// an INSERT. Shape is intentionally loose — callers read what they need.
interface PhoneCallRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: "in" | "out";
  status: string | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  [key: string]: unknown;
}

// Slice 9 (#313) — a phone_voicemails row as it arrives on a realtime UPDATE
// (the transcription-completed webhook fills transcript + flips status).
export interface PhoneVoicemailRow {
  id: string;
  organization_id: string;
  phone_call_id: string;
  audio_storage_path: string | null;
  transcript: string | null;
  transcript_status: "pending" | "ready" | "failed";
  duration_seconds: number | null;
  [key: string]: unknown;
}

export interface UsePhoneSyncInput {
  supabase: SupabaseClient;
  // The active org. Null while loading or when the user is logged out;
  // the hook holds no subscription in that state.
  organizationId: string | null;
  onNewMessage: (row: PhoneMessageRow) => void;
  // Slice 7 (#311) — optional. When provided, the hook also subscribes to
  // `phone_messages` UPDATEs so a message re-tagged to a Job after the fact
  // (job_tag changed) can resurface in realtime. Omitted by the Phone-tab
  // caller, which only cares about new arrivals — so no UPDATE subscription
  // is registered there and its behavior is unchanged.
  onMessageUpdate?: (row: PhoneMessageRow) => void;
  // Slice 10 (#314) — optional. When provided, the hook also subscribes to
  // `phone_calls` INSERTs (a new call placed elsewhere or an inbound ring).
  onNewCall?: (row: PhoneCallRow) => void;
  // Slice 10 (#314) — optional. When provided, the hook also subscribes to
  // `phone_calls` UPDATEs so the Phone-tab thread's in-flight call indicator
  // advances live (queued → ringing → in_progress → completed) as the
  // status-callback webhook stamps the row. Callers that pass neither call
  // callback register no phone_calls subscription at all.
  onCallUpdate?: (row: PhoneCallRow) => void;
  // Slice 9 (#313) — optional. When provided, the hook also subscribes to
  // `phone_voicemails` UPDATEs so a transcript that lands after the call row
  // rendered (the transcription-completed webhook) flips "Transcribing…" to
  // the text in realtime. The Job-page Messages caller omits it.
  onVoicemailUpdate?: (row: PhoneVoicemailRow) => void;
}

// Channel topics must be unique PER HOOK MOUNT, not per org. RealtimeClient
// dedupes channels by topic, so two mounts sharing a topic (the Job page
// mounts Messages (N) and Calls (N), both syncing the active org) would hand
// the second mount the first's already-subscribed channel — and realtime-js
// throws from `.on("postgres_changes", …)` once a channel is joining/joined,
// which took down every Job page (prod incident 2026-06-10). The suffix costs
// one extra realtime subscription per mount; postgres_changes filtering is
// per-binding, so behavior is otherwise identical.
let channelSeq = 0;

export function usePhoneSync(input: UsePhoneSyncInput): void {
  const onNewMessageRef = useRef(input.onNewMessage);
  const onMessageUpdateRef = useRef(input.onMessageUpdate);
  const onNewCallRef = useRef(input.onNewCall);
  const onCallUpdateRef = useRef(input.onCallUpdate);
  const onVoicemailUpdateRef = useRef(input.onVoicemailUpdate);
  // useLayoutEffect (or useEffect — either works since the effect runs
  // before the next event-loop tick that fires the subscription handler)
  // keeps the ref read-only during render, satisfying react-hooks/refs.
  useLayoutEffect(() => {
    onNewMessageRef.current = input.onNewMessage;
    onMessageUpdateRef.current = input.onMessageUpdate;
    onNewCallRef.current = input.onNewCall;
    onCallUpdateRef.current = input.onCallUpdate;
    onVoicemailUpdateRef.current = input.onVoicemailUpdate;
  }, [
    input.onNewMessage,
    input.onMessageUpdate,
    input.onNewCall,
    input.onCallUpdate,
    input.onVoicemailUpdate,
  ]);

  const { supabase, organizationId } = input;
  // Whether to register each optional subscription is decided once per
  // (org) effect run; toggling a callback's presence is rare and a
  // remount-worthy change, so it gates the effect rather than living
  // behind the ref.
  const wantsUpdates = input.onMessageUpdate != null;
  const wantsCallInsert = input.onNewCall != null;
  const wantsCallUpdate = input.onCallUpdate != null;
  const wantsVoicemailUpdates = input.onVoicemailUpdate != null;

  useEffect(() => {
    if (!organizationId) return;
    const orgFilter = `organization_id=eq.${organizationId}`;
    let channel = supabase
      .channel(`phone-messages-${organizationId}-${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "phone_messages",
          filter: orgFilter,
        },
        (payload: { new: PhoneMessageRow }) => {
          onNewMessageRef.current(payload.new);
        },
      );

    if (wantsUpdates) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "phone_messages",
          filter: orgFilter,
        },
        (payload: { new: PhoneMessageRow }) => {
          onMessageUpdateRef.current?.(payload.new);
        },
      );
    }

    // Slice 10 (#314) — outbound-call realtime. Same channel, additional
    // postgres_changes registrations on `phone_calls`, only when wanted.
    if (wantsCallInsert) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "phone_calls",
          filter: orgFilter,
        },
        (payload: { new: PhoneCallRow }) => {
          onNewCallRef.current?.(payload.new);
        },
      );
    }

    if (wantsCallUpdate) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "phone_calls",
          filter: orgFilter,
        },
        (payload: { new: PhoneCallRow }) => {
          onCallUpdateRef.current?.(payload.new);
        },
      );
    }

    // Slice 9 (#313) — voicemail transcript realtime. A transcript that
    // lands after the call row rendered arrives as a phone_voicemails UPDATE.
    if (wantsVoicemailUpdates) {
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "phone_voicemails",
          filter: orgFilter,
        },
        (payload: { new: PhoneVoicemailRow }) => {
          onVoicemailUpdateRef.current?.(payload.new);
        },
      );
    }

    const subscribed = channel.subscribe();

    return () => {
      subscribed.unsubscribe();
    };
  }, [
    supabase,
    organizationId,
    wantsUpdates,
    wantsCallInsert,
    wantsCallUpdate,
    wantsVoicemailUpdates,
  ]);
}
