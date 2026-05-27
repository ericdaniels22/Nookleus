"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { Job } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

export interface UnreadResponseThread {
  thread_id: string;
  job_id: string | null;
  latest_email_id: string;
  latest_subject: string;
  latest_from_name: string | null;
  latest_from_address: string;
  latest_snippet: string | null;
  latest_received_at: string;
  unread_count: number;
}

interface UseDashboardData {
  newJobs: Job[];
  newJobsCount: number;
  unreadResponseThreads: UnreadResponseThread[];
  unreadResponsesCount: number;
  loading: boolean;
  error: string | null;
  canViewJobs: boolean;
  canViewEmail: boolean;
}

export function useDashboardData(): UseDashboardData {
  const { hasPermission } = useAuth();
  const canViewJobs = hasPermission("view_jobs");
  const canViewEmail = hasPermission("view_email");

  const [newJobs, setNewJobs] = useState<Job[]>([]);
  const [newJobsCount, setNewJobsCount] = useState(0);
  const [unreadResponseThreads, setUnreadResponseThreads] = useState<
    UnreadResponseThread[]
  >([]);
  const [unreadResponsesCount, setUnreadResponsesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewJobs && !canViewEmail) return;

    let cancelled = false;

    async function load() {
      const supabase = createClient();

      // 'new' is the literal seed status name; no `is_initial` flag exists.
      // Seed rows: supabase/migration-build14c.sql.
      const jobsPromise = canViewJobs
        ? Promise.all([
            supabase
              .from("jobs")
              .select("*, contact:contacts!contact_id(*)")
              .eq("status", "new")
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(3),
            supabase
              .from("jobs")
              .select("*", { count: "exact", head: true })
              .eq("status", "new")
              .is("deleted_at", null),
          ])
        : null;

      // Filter rule lives in supabase/migration-294-unread-response-threads.sql;
      // the view encapsulates Shared-account + category + Active-job rules.
      const threadsPromise = canViewEmail
        ? Promise.all([
            supabase
              .from("unread_response_threads")
              .select("*")
              .order("latest_received_at", { ascending: false })
              .limit(3),
            supabase
              .from("unread_response_threads")
              .select("*", { count: "exact", head: true }),
          ])
        : null;

      const [jobsResult, threadsResult] = await Promise.all([
        jobsPromise,
        threadsPromise,
      ]);

      if (cancelled) return;

      let nextError: string | null = null;

      if (jobsResult) {
        const [previewRes, countRes] = jobsResult;
        if (previewRes.error || countRes.error) {
          nextError =
            previewRes.error?.message ??
            countRes.error?.message ??
            "Failed to load";
        } else {
          setNewJobs((previewRes.data ?? []) as Job[]);
          setNewJobsCount(countRes.count ?? 0);
        }
      }

      if (threadsResult) {
        const [previewRes, countRes] = threadsResult;
        if (previewRes.error || countRes.error) {
          nextError =
            nextError ??
            previewRes.error?.message ??
            countRes.error?.message ??
            "Failed to load";
        } else {
          setUnreadResponseThreads(
            (previewRes.data ?? []) as UnreadResponseThread[]
          );
          setUnreadResponsesCount(countRes.count ?? 0);
        }
      }

      setError(nextError);
      setLoading(false);
    }

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [canViewJobs, canViewEmail]);

  return {
    newJobs,
    newJobsCount,
    unreadResponseThreads,
    unreadResponsesCount,
    loading: canViewJobs || canViewEmail ? loading : false,
    error,
    canViewJobs,
    canViewEmail,
  };
}
