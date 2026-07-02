"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Job } from "@/lib/types";
import { useOpenSessions } from "@/lib/timesheets/use-open-sessions";
import { groupOnSiteNamesByJob } from "@/lib/timesheets/group-on-site";
import JobCard from "@/components/job-card";
import JobListRow from "@/components/job-list-row";
import JobComfortableRow from "@/components/job-comfortable-row";
import JobsViewToggle from "@/components/jobs-view-toggle";
import PageHeader from "@/components/page-header";
import { JobStageSections } from "@/components/job-stage-sections";
import { useJobsViewMode } from "@/lib/jobs/use-jobs-view-mode";
import { loadJobsWithCover } from "@/lib/jobs/jobs-with-cover";
import {
  buildJobsPageSections,
  countOpenJobs,
} from "@/lib/jobs/build-job-sections";
import { getJobStatusOptions } from "@/lib/job-status-presentation";
import { Briefcase, FileText, CalendarDays, Flame, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/config-context";
import { useAuth } from "@/lib/auth-context";
import { canDeleteJobs } from "@/lib/jobs/auth";
import { toast } from "sonner";

const RETENTION_DAYS = 30;

export default function JobsPage() {
  const { statuses } = useConfig();
  const { profile, organizationId } = useAuth();
  const showTrash = canDeleteJobs(profile?.role);

  // One org-wide presence subscription for the whole list (#705): every Job
  // card reads its own names from this, so we open a single realtime channel
  // instead of one per card. view_jobs already guards this page.
  const presenceClient = useMemo(() => createClient(), []);
  const { sessions: openSessions } = useOpenSessions({
    supabase: presenceClient,
    organizationId,
  });
  const onSiteByJob = useMemo(
    () => groupOnSiteNamesByJob(openSessions),
    [openSessions],
  );

  // All five lifecycle stages are selectable (Lead and Lost included), sourced
  // from the status-presentation module so the pills stay in pipeline order and
  // can't drop or duplicate a stage — with per-org label overrides applied.
  const filterOptions = [
    { value: "all", label: "All" },
    { value: "emergency", label: "Emergency" },
    ...getJobStatusOptions(statuses),
    ...(showTrash ? [{ value: "trash", label: "Trash" }] : []),
  ];
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  // The "all" view defers Closed & Lost until this is on (#728). Not persisted —
  // it resets to off on each visit so the default load stays fast.
  const [showClosedLost, setShowClosedLost] = useState(false);
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
    // Closed & Lost are deferred until the toggle reveals them, so toggling it
    // on re-fetches with those stages included (#728).
    const supabase = createClient();
    setJobs(
      await loadJobsWithCover(supabase, filter, {
        includeClosedLost: showClosedLost,
      }),
    );
    setLoading(false);
  }, [filter, showClosedLost]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Compute stats from all active (non-trashed) jobs.
  const [stats, setStats] = useState({
    open: 0,
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
        open: countOpenJobs(allJobs),
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

  // Each stage section renders its Jobs in the page's current view-mode layout.
  // (buildJobsPageSections orders Jobs newest-first within a section and floats
  // open emergencies into a pinned section above the groups, #726. Closed & Lost
  // are deferred from the fetch until the toggle reveals them, #728, so they
  // simply have no section here until then.)
  const renderJobsForMode = (sectionJobs: Job[]) => {
    if (mode === "list") {
      return (
        <div className="space-y-2">
          {sectionJobs.map((job) => (
            <JobListRow key={job.id} job={job} />
          ))}
        </div>
      );
    }
    if (mode === "comfortable") {
      return (
        <div className="space-y-2">
          {sectionJobs.map((job) => (
            <JobComfortableRow key={job.id} job={job} />
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sectionJobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onSiteNames={onSiteByJob.get(job.id) ?? []}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      <PageHeader title="Jobs" subtitle="Track and manage all your jobs." />

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open jobs" value={stats.open} icon={Briefcase} />
        <StatCard label="Emergencies" value={stats.emergency} icon={Flame} />
        <StatCard label="Pending Invoice" value={stats.pendingInvoice} icon={FileText} />
        <StatCard label="This Month" value={stats.thisMonth} icon={CalendarDays} />
      </div>

      {/* Filter pills + view toggle */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            data-testid={`filter-pill-${opt.value}`}
            onClick={() => {
              setFilter(opt.value);
              setLoading(true);
            }}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
              filter === opt.value
                ? "bg-accent-tint text-accent-text border-transparent"
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
      ) : jobs.length === 0 ? (
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
          {jobs.map((job) => (
            <TrashRow key={job.id} job={job} onChange={fetchJobs} />
          ))}
        </div>
      ) : (
        (() => {
          const { pinnedEmergencies, sections } = buildJobsPageSections(jobs);
          return (
            <>
              <JobStageSections
                sections={sections}
                pinnedEmergencies={pinnedEmergencies}
                renderJobs={renderJobsForMode}
              />
              {/* The "all" view defers Closed & Lost (#728); the toggle reveals
                  them. A single stage / Emergency filter fetches that stage
                  directly, so no toggle there. */}
              {filter === "all" && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    data-testid="toggle-closed-lost"
                    onClick={() => {
                      setShowClosedLost((shown) => !shown);
                      setLoading(true);
                    }}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:border-primary/30 hover:shadow-sm"
                  >
                    {showClosedLost ? "Hide" : "Show"} Closed &amp; Lost
                  </button>
                </div>
              )}
            </>
          );
        })()
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
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-lg p-5 bg-card border border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-[22px] font-semibold tabular-nums mt-1 text-foreground">{value}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-accent-tint flex items-center justify-center">
          <Icon size={22} className="text-accent-text" />
        </div>
      </div>
    </div>
  );
}
