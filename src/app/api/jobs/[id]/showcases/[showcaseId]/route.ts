// PUT /api/jobs/[id]/showcases/[showcaseId] — keepalive-capable autosave path
// for the Showcase builder (#613). The builder autosaves title / write_up /
// photo_ids on a debounce; when the page goes away "the hard way" (tab close /
// refresh) a pending edit must still flush, so the builder fires a plain
// keepalive PUT here (the Supabase JS client can't ride keepalive). Admin-only
// (#613 AC) with (id, job_id, active) tenancy scoping, mirroring the report
// autosave route (#478) — tenancy/permission gating stays server-side.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sanitizedJobPhotoIds } from "@/lib/create-showcase";
import { apiDbError } from "@/lib/api-errors";

interface UpdateShowcasePayload {
  title?: string;
  write_up?: string;
  photo_ids?: string[];
}

export const PUT = withRequestContext(
  { adminOnly: true },
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; showcaseId: string }> },
  ) => {
    const { id: jobId, showcaseId } = await params;
    const body = (await request.json()) as UpdateShowcasePayload;

    // Whitelist the editable content columns; only keys actually present in the
    // body are written, so a partial flush never clobbers a field the client
    // didn't send.
    const update: Record<string, unknown> = {};
    if (typeof body.title === "string") update.title = body.title;
    if (typeof body.write_up === "string") update.write_up = body.write_up;
    if (Array.isArray(body.photo_ids)) {
      // Re-run the ownership gate on every photo write so a stored Showcase only
      // ever holds this Job's own photos, deduped and in the chosen order. A
      // public Showcase gallery must never leak another Job's (customer's)
      // photo, so the autosave path is as untrusting as the create path.
      update.photo_ids = await sanitizedJobPhotoIds(
        ctx.supabase,
        jobId,
        body.photo_ids,
      );
    }

    // Scope by job_id as well as id so a Showcase is only writable through its
    // own Job, and `.is("deleted_at", null)` keeps the write to the live row (a
    // trashed Showcase is not editable). `.select().maybeSingle()` tells a real
    // DB error apart from "no row matched" — the latter 404s instead of falsely
    // reporting success. Mirrors the report autosave/delete shape.
    const { data, error } = await ctx.supabase
      .from("showcases")
      .update(update)
      .eq("id", showcaseId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return apiDbError(
        error.message,
        "PUT /api/jobs/[id]/showcases/[showcaseId]",
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
