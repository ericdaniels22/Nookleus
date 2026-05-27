import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  canReTag,
  type PhoneEventForRead,
  type PhoneEventReadCaller,
} from "@/lib/phone/phone-event-access";

// PRD #304 — Nookleus Phone. Slice 4 (#308) — tag (or re-tag) a message.
//
// Body: `{ jobId: string | null }`. A non-null jobId tags the message to
// that Job; null removes the tag. `tagged_by_user_id` is set to the
// caller, so the UI can render "tagged by Alice" later.
//
// Slice 5 (#309) tightens the access policy. The AC reads:
//   "Re-tag menu changes phone_messages.job_tag and is visible only to
//    callers who pass phone-event-access.canRead for the current and
//    target Jobs"
// so the route now refuses re-tag attempts where the caller cannot read
// the current message (e.g. a non-owner Personal-number untagged event)
// OR the target Job is not visible (e.g. doesn't exist in the active
// org, or is restricted by a future per-user Job ACL).

interface MessageRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  job_tag: string | null;
  tagged_by_user_id: string | null;
}

interface ConversationRow {
  id: string;
  organization_id: string;
  phone_number_id: string;
}

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  kind: "shared" | "personal";
  user_id: string | null;
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
      .select("id, organization_id, conversation_id, job_tag, tagged_by_user_id")
      .eq("id", id)
      .maybeSingle<MessageRow>();
    if (!msg || msg.organization_id !== ctx.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Resolve the number kind / owner so canReTag can apply the ADR 0003
    // matrix. Service-client reads — RLS would also approve, but the
    // join through conversation → number is cleaner without it.
    const { data: conv } = await ctx.serviceClient!
      .from("phone_conversations")
      .select("id, organization_id, phone_number_id")
      .eq("id", msg.conversation_id)
      .maybeSingle<ConversationRow>();
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data: num } = await ctx.serviceClient!
      .from("phone_numbers")
      .select("id, organization_id, kind, user_id")
      .eq("id", conv.phone_number_id)
      .maybeSingle<PhoneNumberRow>();
    if (!num) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Target-Job visibility — slice 5 uses the schema.sql "every member
    // sees every Job in their active org" policy, same as the read path.
    // If a per-user Job ACL lands later, this gate refines automatically.
    let targetJobVisible = false;
    if (jobId !== null) {
      const { data: job } = await ctx.serviceClient!
        .from("jobs")
        .select("id, organization_id")
        .eq("id", jobId)
        .eq("organization_id", ctx.orgId)
        .maybeSingle<{ id: string; organization_id: string }>();
      targetJobVisible = !!job;
    }

    const readCaller: PhoneEventReadCaller = {
      userId: ctx.userId,
      organizationId: ctx.orgId ?? "",
      role: ctx.role,
      grantedPermissions: ctx.grantedPermissions,
    };
    const event: PhoneEventForRead = {
      organizationId: msg.organization_id,
      numberKind: num.kind,
      numberOwnerId: num.user_id,
      jobTag: msg.job_tag,
    };
    // Current-Job visibility: matches the canRead path. For Shared this
    // is irrelevant (Shared is always team-visible); for Personal it
    // gates the non-owner Job-tagged case.
    const currentJobVisible = true;

    const allowed = canReTag(readCaller, event, {
      jobVisibleToCaller: currentJobVisible,
      targetJobId: jobId ?? null,
      targetJobVisibleToCaller: targetJobVisible,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 },
      );
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
