import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/thread/[threadId] — get all emails in a thread.
// Requires `view_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const GET = withRequestContext(
  { permission: "view_email" },
  async (_request, ctx, { params }: { params: Promise<{ threadId: string }> }) => {
    const { threadId } = await params;

    const { data, error } = await ctx.supabase
      .from("emails")
      .select("*, job:jobs(id, job_number, property_address), attachments:email_attachments(*)")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  },
);
