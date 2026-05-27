import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — tag (or re-tag) a message.
//
// Body: `{ jobId: string | null }`. A non-null jobId tags the message to
// that Job; null removes the tag. `tagged_by_user_id` is set to the
// caller, so the UI can render "tagged by Alice" later.
//
// AC bullet: "An inbound SMS from a known Contact with multiple Active
// jobs lands untagged with the prompt-chips state captured" — the chips
// POST to this route.
//
// Re-tagging an auto-tagged message also flows through here (slice 9).

interface MessageRow {
  id: string;
  organization_id: string;
  job_tag: string | null;
  tagged_by_user_id: string | null;
}

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { jobId?: string | null }
      | null;
    if (!body || !("jobId" in body)) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    const jobId = body.jobId;

    const { data: msg } = await ctx.serviceClient!
      .from("phone_messages")
      .select("id, organization_id, job_tag, tagged_by_user_id")
      .eq("id", id)
      .maybeSingle<MessageRow>();
    if (!msg || msg.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { error } = await ctx.serviceClient!
      .from("phone_messages")
      .update({ job_tag: jobId, tagged_by_user_id: ctx.userId })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  },
);
