import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { createPhotoReportDraft } from "@/lib/photo-reports";
import { apiDbError } from "@/lib/api-errors";

interface CreateReportPayload {
  photoIds?: string[];
}

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

    const { data: profile } = await ctx.supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", ctx.userId)
      .maybeSingle<{ full_name: string }>();
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 403 });
    }

    const body = (await request.json()) as CreateReportPayload;
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds : [];

    try {
      const report = await createPhotoReportDraft(ctx.supabase, {
        organizationId: ctx.orgId,
        jobId,
        preparerName: profile.full_name,
        photoIds,
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
