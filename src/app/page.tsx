"use client";

import { useAuth } from "@/lib/auth-context";
import { useDashboardData } from "@/lib/dashboard/use-dashboard-data";
import { getFirstName } from "@/lib/first-name";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { NewJobsSection } from "@/components/dashboard/new-jobs-section";
import { UnreadResponsesSection } from "@/components/dashboard/unread-responses-section";

export default function DashboardPage() {
  const { profile } = useAuth();
  const {
    newJobs,
    newJobsCount,
    unreadResponseThreads,
    unreadResponsesCount,
    canViewJobs,
    canViewEmail,
  } = useDashboardData();

  const firstName = getFirstName(profile?.full_name);

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-foreground">
          <span className="gradient-text">Dashboard</span>
        </h1>
        <p className="text-muted-foreground mt-1">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        </p>
      </div>

      <StatStrip
        newJobsCount={newJobsCount}
        canViewJobs={canViewJobs}
        unreadResponsesCount={unreadResponsesCount}
        canViewEmail={canViewEmail}
      />

      {canViewJobs && <NewJobsSection jobs={newJobs} total={newJobsCount} />}

      {canViewEmail && (
        <UnreadResponsesSection
          threads={unreadResponseThreads}
          total={unreadResponsesCount}
        />
      )}
    </div>
  );
}
