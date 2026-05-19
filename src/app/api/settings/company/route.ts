import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/company — fetch all company settings for the active org.
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const GET = withRequestContext({ permission: "access_settings" }, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value || "";
  }

  return NextResponse.json(settings);
});

// PUT /api/settings/company — upsert company settings for the active org.
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const PUT = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const body = await request.json();
  const orgId = ctx.orgId;

  const entries = Object.entries(body).filter(
    ([key]) => typeof key === "string" && key.length > 0
  );

  for (const [key, value] of entries) {
    const { error } = await ctx.supabase
      .from("company_settings")
      .upsert(
        { organization_id: orgId, key, value: String(value ?? ""), updated_at: new Date().toISOString() },
        { onConflict: "organization_id,key" }
      );

    if (error) {
      return NextResponse.json(
        { error: `Failed to save ${key}: ${error.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true });
});
