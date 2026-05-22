import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { belongsToActiveOrganization } from "@/lib/request-context/belongs-to-active-organization";
import {
  deleteConversationAttachments,
  type StorageClient,
} from "@/lib/jarvis/attachments/storage";

// Issue #198 — DELETE a Jarvis conversation.
//
// Deleting the conversation row alone would orphan its image attachments
// in the `jarvis-attachments` bucket. This route deletes the bucket
// objects under the conversation prefix first, then the row — both on the
// Service client, scoped to the caller's Organization. The attachment
// sweep runs first and strictly: if storage fails the row survives, so a
// retry is always safe (the prefix delete is idempotent).
export const DELETE = withRequestContext(
  { serviceClient: true },
  async (
    _request,
    ctx,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const service = ctx.serviceClient!;

    if (
      !(await belongsToActiveOrganization(
        service,
        { table: "jarvis_conversations", id },
        ctx.orgId,
      ))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      await deleteConversationAttachments(
        service as StorageClient,
        ctx.orgId!,
        id,
      );
    } catch (err) {
      console.error("Failed to delete Jarvis attachments:", err);
      return NextResponse.json(
        { error: "Couldn't remove the conversation's attachments — try again." },
        { status: 500 },
      );
    }

    const { error } = await service
      .from("jarvis_conversations")
      .delete()
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  },
);
