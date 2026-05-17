// POST /api/jobs/[id]/delete — soft-delete a job (move to trash).
// Sets jobs.deleted_at = now(); the row stays in the DB and continues to
// hide from active queries until either restored or hard-deleted (via
// /api/jobs/[id] DELETE) or auto-purged after 30 days by GET
// /api/jobs/trash.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const POST = withRequestContext(
  { roles: ["admin", "office_staff"] },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { error } = await ctx.supabase
      .from("jobs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
