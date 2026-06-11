import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePagePermission } from "@/lib/request-context/require-page-permission";
import PhotoReportBuilder from "@/components/photo-report-builder";
import type { PhotoReport, PhotoTag } from "@/lib/types";
import type { PickerPhoto } from "@/components/photo-report-add-photos-dialog";

// The Job-scoped Photo Report builder route (#400). A builder route in the
// AppShell `BUILDER_ROUTE_PATTERNS` sense (#548): the app nav renders as the
// slim collapsed rail beside the builder. The page fetches the draft + its
// photos server-side (RLS scopes to the active org) and hands them to the
// client builder, which auto-saves edits.
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
  // the Job Photos tab's ordering and join shape: the picker's Tags filter
  // matches client-side on the joined assignment ids.
  const { data: photoData } = await supabase
    .from("photos")
    .select("*, photo_tag_assignments(tag_id)")
    .eq("job_id", jobId)
    .order("taken_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<PickerPhoto[]>();
  const photos: PickerPhoto[] = photoData ?? [];

  // The Organization's tag vocabulary for the picker's Tags filter (RLS
  // scopes to the active org). Name-ordered like the Photos tab's dropdown.
  const { data: tagData } = await supabase
    .from("photo_tags")
    .select("*")
    .order("name")
    .returns<PhotoTag[]>();
  const tags: PhotoTag[] = tagData ?? [];

  // The Job's own cover photo seeds the report's Cover Page when the report has
  // not chosen its own (ADR 0014, #551). Read it here so the builder can resolve
  // the fallback without a second round-trip.
  const { data: job } = await supabase
    .from("jobs")
    .select("cover_photo_id")
    .eq("id", jobId)
    .maybeSingle<{ cover_photo_id: string | null }>();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  return (
    <PhotoReportBuilder
      jobId={jobId}
      report={report}
      photos={photos}
      supabaseUrl={supabaseUrl}
      tags={tags}
      jobCoverPhotoId={job?.cover_photo_id ?? null}
    />
  );
}
