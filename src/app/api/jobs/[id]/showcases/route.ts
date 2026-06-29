// POST /api/jobs/[id]/showcases — create the Job's one draft Showcase (#613).
//
// A Showcase is one public-facing story per Job. The Job detail's "Create
// showcase" action POSTs here; the route is admin-only (#613 AC: every Showcase
// surface is admin-only), verifies the URL's Job is visible to the caller's
// Organization before referencing it, then hands off to the create step, which
// owns the data work (photo sanitize + the one-per-Job insert).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  createShowcaseDraft,
  ShowcaseAlreadyExistsError,
} from "@/lib/create-showcase";
import { apiDbError } from "@/lib/api-errors";

interface CreateShowcasePayload {
  title?: string;
  writeUp?: string;
  photoIds?: string[];
}

export const POST = withRequestContext(
  { adminOnly: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: jobId } = await params;
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    // Verify the URL's Job is visible to the caller's Organization before
    // referencing it (mirrors the report create route, #446). `ctx.supabase` is
    // RLS-scoped, so a cross-org or nonexistent job id resolves to no row — both
    // 404 identically, leaking no existence oracle. Without this, the insert
    // would stamp a Showcase with the caller's org_id but a foreign job_id.
    const { data: job, error: jobError } = await ctx.supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle<{ id: string }>();
    if (jobError) {
      return apiDbError(jobError.message, "POST /api/jobs/[id]/showcases");
    }
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // A malformed or empty body is treated as an empty payload — the only fields
    // we read are optional, so "create a blank Showcase to fill in the builder"
    // is the sensible fallback (the Job detail button POSTs an empty body).
    const body = (await request
      .json()
      .catch(() => ({}))) as CreateShowcasePayload;
    const title = typeof body.title === "string" ? body.title : undefined;
    const writeUp = typeof body.writeUp === "string" ? body.writeUp : undefined;
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds : [];

    try {
      const showcase = await createShowcaseDraft(ctx.supabase, {
        organizationId: ctx.orgId,
        jobId,
        createdBy: ctx.userId,
        title,
        writeUp,
        photoIds,
      });
      return NextResponse.json({ showcase }, { status: 201 });
    } catch (err) {
      // A Job already has a live Showcase: surface the one-per-Job conflict as
      // 409 (the admin deletes the existing one to start over) rather than 500.
      if (err instanceof ShowcaseAlreadyExistsError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      return apiDbError(
        err instanceof Error ? err.message : "insert failed",
        "POST /api/jobs/[id]/showcases",
      );
    }
  },
);
