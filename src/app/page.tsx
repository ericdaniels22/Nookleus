"use client";

import Link from "next/link";
import { Plus, Briefcase, Mail } from "lucide-react";

import { useAuth } from "@/lib/auth-context";
import { useDashboardData } from "@/lib/dashboard/use-dashboard-data";
import { getFirstName } from "@/lib/first-name";
import { buttonVariants } from "@/components/ui/button";
import PageHeader from "@/components/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { NewJobsSection } from "@/components/dashboard/new-jobs-section";
import { UnreadResponsesSection } from "@/components/dashboard/unread-responses-section";
import HomeClockControl from "@/components/time/home-clock-control";
import OnTheClockNow from "@/components/time/on-the-clock-now";

export default function DashboardPage() {
  const { profile } = useAuth();
  const {
    newJobs,
    newJobsCount,
    unreadResponseThreads,
    unreadResponsesCount,
    loading,
    error,
    canViewJobs,
    canViewEmail,
  } = useDashboardData();

  const firstName = getFirstName(profile?.full_name);

  return (
    // §5 motion: no entrance animation on dashboards. Width is owned by the app
    // shell (max-w-1440 + responsive padding), so the page itself is fluid.
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        actions={
          <Link href="/intake" className={buttonVariants()}>
            <Plus />
            New intake
          </Link>
        }
      />

      <HomeClockControl />

      <OnTheClockNow />

      {/* KPI metric row (§4): 2×2 on phone, 4-up from md. Each card gates on the
          same permission as its detail widget below. */}
      {(canViewJobs || canViewEmail) && (
        <div
          data-testid="kpi-row"
          className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"
        >
          {canViewJobs && (
            <MetricCard
              label="New jobs"
              value={newJobsCount}
              icon={Briefcase}
              href="/jobs"
              loading={loading}
            />
          )}
          {canViewEmail && (
            <MetricCard
              label="Unread responses"
              value={unreadResponsesCount}
              icon={Mail}
              href="/email"
              loading={loading}
            />
          )}
        </div>
      )}

      {/* Widget grid (§4): single column below 900px, 2-col above. */}
      <div className="grid grid-cols-1 gap-6 min-[900px]:grid-cols-2">
        {canViewJobs && (
          <NewJobsSection
            jobs={newJobs}
            total={newJobsCount}
            loading={loading}
            error={error}
          />
        )}

        {canViewEmail && (
          <UnreadResponsesSection
            threads={unreadResponseThreads}
            total={unreadResponsesCount}
            loading={loading}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
