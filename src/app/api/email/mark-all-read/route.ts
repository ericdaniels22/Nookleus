import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/email/mark-all-read — mark all emails in a folder as read
// Body: { folder: string, accountId?: string }
// Requires `send_email` (#105, PRD #95) — tightened from the logged-in-only
// gate the #85 Request-Context conversion gave this previously-ungated route.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const { folder, accountId } = await request.json();

  if (!folder) {
    return NextResponse.json({ error: "folder is required" }, { status: 400 });
  }

  let query = ctx.supabase
    .from("emails")
    .update({ is_read: true })
    .eq("is_read", false)
    .eq("folder", folder);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});
