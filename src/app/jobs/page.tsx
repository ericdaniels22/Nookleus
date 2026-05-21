"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Job } from "@/lib/types";
import JobCard from "@/components/job-card";
import JobListRow, { JobListHeader } from "@/components/job-list-row";
import JobComfortableRow from "@/components/job-comfortable-row";
import JobsViewToggle from "@/components/jobs-view-toggle";
import { useJobsViewMode } from "@/lib/jobs/use-jobs-view-mode";
import { loadJobsWithCover } from "@/lib/jobs/jobs-with-cover";
import { Briefcase, FileText, CalendarDays, Flame, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/config-context";
import { useAuth } from "@/lib/auth-context";
import { canDeleteJobs } from "@/lib/jobs/auth";
import { toast } from "sonner";

const RETENTION_DAYS = 30;

export default function JobsPage() {
  const { statuses } = useConfig();
  const { profile } = useAuth();
  const showTrash = canDeleteJobs(profile?.role);

  const filterOptions = [
    { value: "all", label: "All" },
    { value: "emergency", label: "Emergency" },
    ...statuses
      .filter((s) => !["new", "cancelled"].includes(s.name))
      .map((s) => ({ value: s.name, label: s.display_label })),
    ...(showTrash ? [{ value: "trash", label: "Trash" }] : []),
  ];
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const { mode, setMode } = useJobsViewMode();

  const fetchJobs = useCallback(async () => {
    if (filter === "trash") {
      const res = await fetch("/api/jobs/trash");
      if (res.ok) {
        const data = await res.json();
        setJobs((data.jobs ?? []) as Job[]);
      } else {
        setJobs([]);
      }
      setLoading(false);
      return;
    }

    // One batched query joins each job to its cover photo, so the
    // Comfortable view needs no per-job lookup; Cards and List ignore it.
    const supabase = createClient();
    setJobs(await loadJobsWithCover(supabase, filter));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Compute stats from all active (non-trashed) jobs.
  const [stats, setStats] = useState({
    active: 0,
    emergency: 0,
    pendingInvoice: 0,
    thisMonth: 0,
  });

  useEffect(() => {
    async function fetchStats() {
      const supabase = createClient();
      const { data: allJobs } = await supabase
        .from("jobs")
        .select("status, urgency, created_at")
        .is("deleted_at", null);

      if (!allJobs) return;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      setStats({
        active: allJobs.filter(
          (j) => j.status !== "completed" && j.status !== "cancelled"
        ).length,
        emergency: allJobs.filter(
          (j) =>
            j.urgency === "emergency" &&
            j.status !== "completed" &&
            j.status !== "cancelled"
        ).length,
        pendingInvoice: allJobs.filter(
          (j) => j.status === "pending_invoice"
        ).length,
        thisMonth: allJobs.filter(
          (j) => new Date(j.created_at) >= monthStart
        ).length,
      });
    }
    fetchStats();
  }, []);

  // Sort: emergencies first, then by date — except in trash, where the
  // API has already sorted by deletion time (most recent first).
  const sortedJobs =
    filter === "trash"
      ? jobs
      : [...jobs].sort((a, b) => {
          if (a.urgency === "emergency" && b.urgency !== "emergency") return -1;
          if (b.urgency === "emergency" && a.urgency !== "emergency") return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-foreground">
          <span className="gradient-text">Jobs</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          Track and manage all your jobs.
        </p>
      </div>

      {/* Stat cards — gradient hero style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          gradient="gradient-primary"
        />
        <StatCard
          label="Emergencies"
          value={stats.emergency}
          icon={Flame}
          gradient="gradient-accent"
        />
        <StatCard
          label="Pending Invoice"
          value={stats.pendingInvoice}
          icon={FileText}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
        />
        <StatCard
          label="This Month"
          value={stats.thisMonth}
          icon={CalendarDays}
          gradient="gradient-secondary"
        />
      </div>

      {/* Filter pills + view toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setFilter(opt.value);
              setLoading(true);
            }}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
              filter === opt.value
                ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
            )}
          >
            {opt.label}
          </button>
        ))}
        {/* The view toggle is hidden in Trash — Trash always renders as
            rows and is unaffected by the Cards/List preference. */}
        {filter !== "trash" && (
          <div className="ml-auto">
            <JobsViewToggle mode={mode} onChange={setMode} />
          </div>
        )}
      </div>

      {/* Job list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground/60">Loading jobs...</div>
      ) : sortedJobs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">
            {filter === "trash" ? "Trash is empty" : "No jobs found"}
          </p>
          {filter !== "trash" && (
            <p className="text-muted-foreground/60 text-sm mt-1">
              Create a new intake to get started.
            </p>
          )}
        </div>
      ) : filter === "trash" ? (
        <div className="space-y-3">
          {sortedJobs.map((job) => (
            <TrashRow key={job.id} job={job} onChange={fetchJobs} />
          ))}
        </div>
      ) : mode === "list" ? (
        <div className="space-y-2">
          <JobListHeader />
          {sortedJobs.map((job) => (
            <JobListRow key={job.id} job={job} />
          ))}
        </div>
      ) : mode === "comfortable" ? (
        <div className="space-y-2">
          {sortedJobs.map((job) => (
            <JobComfortableRow key={job.id} job={job} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrashRow({ job, onChange }: { job: Job; onChange: () => void }) {
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);

  // Capture "now" once when the row mounts — the useState initializer can
  // call Date.now() since it runs before render (lint rule blocks impure
  // calls from the render body itself). Days remaining is a pure
  // derivation from that captured timestamp.
  const [mountedAt] = useState(() => Date.now());
  const daysRemaining = job.deleted_at
    ? Math.max(
        0,
        RETENTION_DAYS -
          Math.floor((mountedAt - new Date(job.deleted_at).getTime()) / 86_400_000),
      )
    : null;

  async function handleRestore() {
    setBusy("restore");
    const res = await fetch(`/api/jobs/${job.id}/restore`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Couldn't restore job");
      return;
    }
    toast.success("Job restored");
    onChange();
  }

  async function handlePurge() {
    if (
      !confirm(
        "Permanently delete this job and all its photos and files? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy("purge");
    const res = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      toast.error("Couldn't delete job");
      return;
    }
    toast.success("Job permanently deleted");
    onChange();
  }

  const customer = job.contact ? job.contact.full_name : "Unknown";

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono text-muted-foreground/60">{job.job_number}</p>
        <Link
          href={`/jobs/${job.id}`}
          className="text-base font-semibold text-foreground hover:underline"
        >
          {customer}
        </Link>
        <p className="text-sm text-muted-foreground truncate">{job.property_address}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {daysRemaining !== null
            ? daysRemaining === 0
              ? "Auto-purges today"
              : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} until permanent deletion`
            : null}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleRestore}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {busy === "restore" ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
          Restore
        </button>
        <button
          type="button"
          onClick={handlePurge}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
        >
          {busy === "purge" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete forever
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  gradient,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  gradient: string;
}) {
  return (
    <div
      className={`rounded-xl p-5 text-white shadow-lg ${gradient}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-white/70 uppercase tracking-wider">
            {label}
          </p>
          <p className="text-3xl font-extrabold mt-1">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center">
          <Icon size={22} className="text-white" />
        </div>
      </div>
    </div>
  );
}
