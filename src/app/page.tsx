"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Briefcase, FileText, CalendarDays, Camera } from "lucide-react";
import Link from "next/link";
import { Job } from "@/lib/types";
import JobCard from "@/components/job-card";
import { useAuth } from "@/lib/auth-context";
import { getFirstName } from "@/lib/first-name";

export default function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ active: 0, pendingInvoice: 0, thisMonth: 0, reports: 0 });
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);

  const firstName = getFirstName(profile?.full_name);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Fetch all active jobs + report count for stats. Trashed jobs
      // (deleted_at IS NOT NULL) are excluded from the dashboard.
      const [{ data: allJobs }, { count: reportCount }] = await Promise.all([
        supabase
          .from("jobs")
          .select("status, urgency, created_at")
          .is("deleted_at", null),
        supabase.from("photo_reports").select("*", { count: "exact", head: true }),
      ]);

      if (allJobs) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        setStats({
          active: allJobs.filter(
            (j) => j.status !== "completed" && j.status !== "cancelled"
          ).length,
          pendingInvoice: allJobs.filter(
            (j) => j.status === "pending_invoice"
          ).length,
          thisMonth: allJobs.filter(
            (j) => new Date(j.created_at) >= monthStart
          ).length,
          reports: reportCount ?? 0,
        });
      }

      // Fetch 4 most recent active jobs (trashed jobs are hidden).
      const { data: recent } = await supabase
        .from("jobs")
        .select("*, contact:contacts!contact_id(*)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(4);

      if (recent) setRecentJobs(recent as Job[]);
    }
    load();
  }, []);

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-foreground">
          <span className="gradient-text">Dashboard</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."} Here&apos;s your overview.
        </p>
      </div>

      {/* Stat cards — gradient hero style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Jobs"
          value={stats.active}
          icon={Briefcase}
          gradient="gradient-primary"
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
        <StatCard
          label="Reports"
          value={stats.reports}
          icon={Camera}
          gradient="gradient-accent"
        />
      </div>

      {/* Recent jobs */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Recent Jobs</h2>
        <Link
          href="/jobs"
          className="text-sm text-primary hover:underline font-medium"
        >
          View all
        </Link>
      </div>
      {recentJobs.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border shadow-[var(--shadow-card)]">
          <p className="text-muted-foreground">No jobs yet.</p>
          <Link
            href="/intake"
            className="text-sm text-primary hover:underline font-medium mt-1 inline-block"
          >
            Create your first intake
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recentJobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
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
