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

export interface UsePhoneSyncInput {
  supabase: SupabaseClient;
  // The active org. Null while loading or when the user is logged out;
  // the hook holds no subscription in that state.
  organizationId: string | null;
  onNewMessage: (row: PhoneMessageRow) => void;
}

export function usePhoneSync(input: UsePhoneSyncInput): void {
  const onNewMessageRef = useRef(input.onNewMessage);
  // useLayoutEffect (or useEffect — either works since the effect runs
  // before the next event-loop tick that fires the subscription handler)
  // keeps the ref read-only during render, satisfying react-hooks/refs.
  useLayoutEffect(() => {
    onNewMessageRef.current = input.onNewMessage;
  }, [input.onNewMessage]);

  const { supabase, organizationId } = input;

  useEffect(() => {
    if (!organizationId) return;
    const channel = supabase
      .channel(`phone-messages-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "phone_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: { new: PhoneMessageRow }) => {
          onNewMessageRef.current(payload.new);
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [supabase, organizationId]);
}
