// POST /api/jobs/[id]/restore — pull a job back out of the trash.
// Clears jobs.deleted_at. Idempotent: a job that's already active is a
// no-op.

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const POST = withRequestContext(
  { roles: ["admin", "office_staff"] },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const { error } = await ctx.supabase
      .from("jobs")
      .update({ deleted_at: null })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
