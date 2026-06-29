// POST /api/jobs/[id]/showcases/[showcaseId]/restore — pull a Showcase back out
// of the trash (#613). Clears showcases.deleted_at so the row returns to the
// live set. Admin-only (#613 AC) and idempotent: restoring an already-live
// Showcase is a no-op. Mirrors the Photo Report restore route (#402).

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";

export const POST = withRequestContext(
  { adminOnly: true },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string; showcaseId: string }> },
  ) => {
    const { id: jobId, showcaseId } = await params;

    // We only restore rows currently in the trash — `.not("deleted_at", "is",
    // null)` makes restoring an already-live Showcase a no-op. The
    // `.select().maybeSingle()` distinguishes a real DB error from "no trashed
    // row matched", which 404s instead of falsely reporting success.
    const { data, error } = await ctx.supabase
      .from("showcases")
      .update({ deleted_at: null })
      .eq("id", showcaseId)
      .eq("job_id", jobId)
      .not("deleted_at", "is", null)
      .select("id")
      .maybeSingle();
    if (error) {
      // Restoring re-adds the row to the live set, so it collides with the
      // one-live-per-Job partial unique index when the Job has since gained a
      // *new* live Showcase (the admin deleted this one, started over, then
      // tried to restore the original). Surface that as an actionable 409 rather
      // than an opaque 500: the admin deletes the current Showcase first.
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "This Job already has a Showcase. Delete it before restoring this one.",
          },
          { status: 409 },
        );
      }
      return apiDbError(
        error.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/restore",
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
