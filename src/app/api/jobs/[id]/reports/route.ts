import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createPhotoReportDraft } from "@/lib/photo-reports";
import { apiDbError } from "@/lib/api-errors";

interface CreateReportPayload {
  photoIds?: string[];
  /** Optional Photo Report template to start from (#405). */
  templateId?: string;
}

/** Trim a value, treating an empty/whitespace string as absent. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Generic stand-in when neither a display name nor an email is available. */
const UNKNOWN_PREPARER = "Unknown";

// POST /api/jobs/[id]/reports — create a draft Photo Report from the Job's
// Photos tab "Create report" bulk action (#400). Runs server-side so the
// report is numbered per Job and stamped with the *real* preparer rather than
// the legacy literal 'Eric'. The Request Context carries only the user id, so
// — like the expenses route — this looks up the display name from
// `user_profiles` to store in `created_by`.
export const POST = withRequestContext(
  { permission: "edit_jobs" },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    // Verify the URL's Job is visible to the caller's Organization before doing
    // any work for it (#446). `ctx.supabase` is RLS-scoped, so a cross-org or
    // nonexistent job id resolves to no row — both 404 identically, leaking no
    // existence oracle. Without this, the create step would stamp a report with
    // the caller's org_id but a foreign job_id (a cross-org dangling reference),
    // since the report-row RLS WITH CHECK validates only organization_id.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle<{ id: string }>();
    if (jobError) {
      return apiDbError(jobError.message, "POST /api/jobs/[id]/reports");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: profile } = await ctx.supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", ctx.userId)
      .maybeSingle<{ full_name: string }>();
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 403 });
    }

    // `full_name` is NOT NULL in the schema but can still be empty/whitespace,
    // which would stamp a blank "Prepared by" onto the report. Fall back to the
    // caller's email (looked up lazily, only when the name is blank), and a
    // generic placeholder only if even that is unavailable — so the report is
    // always attributed to *someone* rather than going blank.
    let preparerName = blankToNull(profile.full_name);
    if (!preparerName) {
      const { data: userData } = await ctx.supabase.auth.getUser();
      preparerName = blankToNull(userData.user?.email) ?? UNKNOWN_PREPARER;
    }

    // A malformed or empty body is treated as an empty payload rather than
    // surfacing a 500: the only fields we read are optional, so "create a blank
    // report" is the sensible fallback.
    const body = (await request
      .json()
      .catch(() => ({}))) as CreateReportPayload;
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds : [];
    const templateId =
      typeof body.templateId === "string" ? body.templateId : null;

    try {
      const report = await createPhotoReportDraft(ctx.supabase, {
        organizationId: ctx.orgId,
        jobId,
        preparerName,
        photoIds,
        templateId,
      });
      return NextResponse.json({ report }, { status: 201 });
    } catch (err) {
      return apiDbError(
        err instanceof Error ? err.message : "insert failed",
        "POST /api/jobs/[id]/reports",
      );
    }
  },
);
