import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/intake-form/versions — last 20 versions for the active org.
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext({}, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("form_config")
    .select("version, created_by, created_at")
    .eq("organization_id", ctx.orgId)
    .order("version", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ versions: data ?? [] });
});
