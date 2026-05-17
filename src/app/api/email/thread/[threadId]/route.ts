import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/thread/[threadId] — get all emails in a thread.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext(
  {},
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
