import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

const APPEARANCE_KEYS = ["brand_primary", "brand_secondary", "brand_accent"];

// GET /api/settings/appearance — fetch brand color settings.
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const GET = withRequestContext({}, async (_request, ctx) => {
  const { data, error } = await ctx.supabase
    .from("company_settings")
    .select("key, value")
    .in("key", APPEARANCE_KEYS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data || []) {
    settings[row.key] = row.value || "";
  }

  return NextResponse.json(settings);
});

// PUT /api/settings/appearance — save brand color settings.
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const PUT = withRequestContext({}, async (request, ctx) => {
  const body = await request.json();

  for (const key of APPEARANCE_KEYS) {
    if (key in body) {
      const { error } = await ctx.supabase
        .from("company_settings")
        .upsert(
          { key, value: String(body[key] || ""), updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );

      if (error) {
        return NextResponse.json(
          { error: `Failed to save ${key}: ${error.message}` },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ success: true });
});
