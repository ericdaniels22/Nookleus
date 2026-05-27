"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { Job } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

interface UseDashboardData {
  newJobs: Job[];
  newJobsCount: number;
  loading: boolean;
  error: string | null;
  canViewJobs: boolean;
}

export function useDashboardData(): UseDashboardData {
  const { hasPermission } = useAuth();
  const canViewJobs = hasPermission("view_jobs");

  const [newJobs, setNewJobs] = useState<Job[]>([]);
  const [newJobsCount, setNewJobsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewJobs) return;

    let cancelled = false;

    async function load() {
      const supabase = createClient();
      // 'new' is the literal seed status name; no `is_initial` flag exists.
      // Seed rows: supabase/migration-build14c.sql.
      const [previewRes, countRes] = await Promise.all([
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
      ]);

      if (cancelled) return;

      if (previewRes.error || countRes.error) {
        setError(previewRes.error?.message ?? countRes.error?.message ?? "Failed to load");
        setLoading(false);
        return;
      }

      setNewJobs((previewRes.data ?? []) as Job[]);
      setNewJobsCount(countRes.count ?? 0);
      setError(null);
      setLoading(false);
    }

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [canViewJobs]);

  // When the viewer lacks view_jobs we skip the fetch entirely; the
  // initial `loading=true` would be misleading there, so derive it.
  return {
    newJobs,
    newJobsCount,
    loading: canViewJobs ? loading : false,
    error,
    canViewJobs,
  };
}
