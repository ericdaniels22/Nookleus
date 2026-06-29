// POST /api/jobs/[id]/showcases/[showcaseId]/delete — move a Showcase to the
// recoverable trash (#613, "delete & start over"). Sets showcases.deleted_at =
// now(); the row stays in the DB but drops out of the live set, which frees the
// one-live-per-Job slot so a fresh Showcase can be created for the Job. Admin
// only (#613 AC). Job CASCADE delete still hard-removes the row. Mirrors the
// Photo Report soft-delete route (#402).

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

    // Scope by job_id as well as id so a Showcase can only be trashed through
    // its own Job, and `.is("deleted_at", null)` keeps the write to the live row
    // (re-deleting an already-trashed Showcase is a no-op, never a re-stamp). The
    // `.select().maybeSingle()` lets us tell a real DB error apart from "no row
    // matched" — the latter 404s instead of falsely reporting success.
    const { data, error } = await ctx.supabase
      .from("showcases")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", showcaseId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return apiDbError(
        error.message,
        "POST /api/jobs/[id]/showcases/[showcaseId]/delete",
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Showcase not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
);
