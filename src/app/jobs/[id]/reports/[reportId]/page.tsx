import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import PhotoReportBuilder from "@/components/photo-report-builder";
import type { Photo, PhotoReport } from "@/lib/types";

// The full-screen, Job-scoped Photo Report builder route (#400). Rendered
// full-screen via the AppShell `INTERNAL_FULLSCREEN_PATTERNS` regex. The page
// fetches the draft + its photos server-side (RLS scopes to the active org) and
// hands them to the client builder, which auto-saves edits.
export default async function PhotoReportBuilderPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const { id: jobId, reportId } = await params;
  const supabase = await createServerSupabaseClient();

  const auth = await requirePagePermission(supabase, { permission: "edit_jobs" });
  if (!auth.ok) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] px-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
          <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
          <h2 className="text-lg font-semibold text-foreground">
            Access restricted
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            You don&apos;t have permission to edit this job&apos;s reports.
          </p>
          <Link
            href="/jobs"
            className="inline-block mt-4 text-sm font-medium text-[#2B5EA7] hover:underline"
          >
            Back to jobs
          </Link>
        </div>
      </div>
    );
  }

  const { data: report } = await supabase
    .from("photo_reports")
    .select("*")
    .eq("id", reportId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle<PhotoReport>();
  if (!report) {
    notFound();
  }

  // Load every photo on the Job (not just the ones already in the report) so
  // the builder can add photos beyond the original selection (#401). Mirrors
  // the Job Photos tab's ordering.
  const { data: photoData } = await supabase
    .from("photos")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .returns<Photo[]>();
  const photos: Photo[] = photoData ?? [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  return (
    <PhotoReportBuilder
      jobId={jobId}
      report={report}
      photos={photos}
      supabaseUrl={supabaseUrl}
    />
  );
}
