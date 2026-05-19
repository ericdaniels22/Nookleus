import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/signatures — get all signatures with account info.
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const GET = withRequestContext({ permission: "access_settings" }, async (_request, ctx) => {
  const { data: accounts } = await ctx.supabase
    .from("email_accounts")
    .select("id, label, email_address, display_name, is_active")
    .order("created_at");

  const { data: signatures } = await ctx.supabase
    .from("email_signatures")
    .select("*");

  const sigMap: Record<string, typeof signatures extends (infer T)[] | null ? T : never> = {};
  for (const sig of signatures || []) {
    sigMap[sig.account_id] = sig;
  }

  const result = (accounts || []).map((acc) => ({
    ...acc,
    signature: sigMap[acc.id] || null,
  }));

  return NextResponse.json(result);
});

// PUT /api/settings/signatures — upsert signature for an account.
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const PUT = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const { account_id, signature_html, include_logo, auto_insert } = await request.json();

  if (!account_id) {
    return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  }

  const { error } = await ctx.supabase
    .from("email_signatures")
    .upsert(
      {
        account_id,
        signature_html: signature_html || "",
        include_logo: include_logo ?? true,
        auto_insert: auto_insert ?? true,
      },
      { onConflict: "account_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});
