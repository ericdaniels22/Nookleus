import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/bot-senders — list ACTIVE bot-sender identities for the
// active org. The inbox uses these to collapse each sender's unread mail into
// a Sender group (grouping is presentation-only; see ADR 0028). Identity is
// the display_name + address PAIR, so callers get both fields.
//
// Gated on view_email; RLS scopes rows to the caller's org, and the explicit
// organization_id filter mirrors the other email read routes.
export const GET = withRequestContext({ permission: "view_email" }, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("bot_senders")
    .select("id, display_name, address, provenance, is_active")
    .eq("organization_id", ctx.orgId)
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ botSenders: data ?? [] });
});
