import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/email/mark-all-read — mark all emails in a folder as read
// Body: { folder: string, accountId?: string }
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const POST = withRequestContext({}, async (request, ctx) => {
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
