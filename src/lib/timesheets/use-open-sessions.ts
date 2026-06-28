"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadOpenSessions,
  type OpenSessionPresence,
} from "./load-open-sessions";

// Presence: the live "who is On the clock" hook (#705, epic #699).
//
// Mirrors usePhoneSync's realtime shape but OWNS a list: instead of forwarding
// each payload to a callback, it re-runs loadOpenSessions (the authoritative,
// off-app-excluding, org/Job-scoped query) on every relevant `time_sessions`
// event and re-renders consumers with the fresh roster. A clock-in is an
// INSERT; a clock-out or Job re-assign is an UPDATE — both invalidate the list.
//
// Channel topics must be unique PER MOUNT, not per org — see usePhoneSync for
// the 2026-06-10 prod incident: RealtimeClient dedupes channels by topic, so two
// mounts sharing a topic hands the second the first's already-joined channel and
// realtime-js throws from `.on(...)`. The Job page can mount both this hook and
// usePhoneSync, and a dashboard + a Job card can co-mount it, so the suffix is
// load-bearing.
let channelSeq = 0;

export interface UseOpenSessionsInput {
  supabase: SupabaseClient;
  // The active org. Null while auth is loading or logged out — the hook holds
  // no subscription and reports an empty roster in that state.
  organizationId: string | null;
  // Optional: narrow to one Job (the per-Job "On site now" surface). Applied in
  // the LOADER, not the realtime filter — see the binding comment below.
  jobId?: string;
}

export interface UseOpenSessionsResult {
  sessions: OpenSessionPresence[];
  loading: boolean;
}

export function useOpenSessions(
  input: UseOpenSessionsInput,
): UseOpenSessionsResult {
  const { supabase, organizationId, jobId } = input;
  const [sessions, setSessions] = useState<OpenSessionPresence[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(organizationId));

  // Out-of-order guard: rapid events fire overlapping refetches, and a slower
  // earlier response must not clobber a newer one. Each load bumps the
  // generation; only the latest may write state.
  const genRef = useRef(0);

  useEffect(() => {
    if (!organizationId) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let active = true;
    const refetch = () => {
      const gen = ++genRef.current;
      setLoading(true);
      loadOpenSessions(supabase, { organizationId, jobId })
        .then((rows) => {
          if (!active || gen !== genRef.current) return;
          setSessions(rows);
          setLoading(false);
        })
        .catch(() => {
          if (!active || gen !== genRef.current) return;
          // Keep the last good roster on a transient error; just stop loading.
          setLoading(false);
        });
    };

    // The realtime binding is filtered by ORG only (postgres_changes allows a
    // single filter per binding). The per-Job surface narrows in the LOADER:
    // filtering the binding by job_id would miss a session whose job_id UPDATEs
    // AWAY from this Job (the worker moved on), leaving them stuck "on site".
    // Org-filtering refetches on any Org change and the loader re-scopes —
    // a few extra refetches, always correct.
    const orgFilter = `organization_id=eq.${organizationId}`;
    const channel = supabase
      .channel(`time-sessions-${organizationId}-${++channelSeq}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "time_sessions",
          filter: orgFilter,
        },
        () => refetch(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "time_sessions",
          filter: orgFilter,
        },
        () => refetch(),
      );

    const subscribed = channel.subscribe();
    refetch(); // initial hydrate

    return () => {
      active = false;
      subscribed.unsubscribe();
    };
  }, [supabase, organizationId, jobId]);

  return { sessions, loading };
}
