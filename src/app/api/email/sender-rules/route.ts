import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { isCategory } from "@/lib/email-categorizer";
import { buildSenderRule, shouldRefile } from "@/lib/email/sender-rule";

// POST /api/email/sender-rules — teach a Sender rule from a move (#957, ADR 0028).
// Body: { fromAddress: string, category: Category }
//
// Creates (or updates) an org-scoped `category_rules` row that files this
// sender address into the chosen bucket, then retroactively re-files that
// sender's existing inbox mail. A manual move always wins: category_locked
// mail is left where the user put it (see `shouldRefile`). Future mail follows
// the rule via the classifier's first-match precedence — sender_address ranks
// above every domain/pattern rule and the Jobs claim heuristics.
export const POST = withRequestContext({ permission: "send_email" }, async (request, ctx) => {
  const body = await request.json();
  const { fromAddress, category } = body;

  if (typeof fromAddress !== "string" || fromAddress.trim() === "") {
    return NextResponse.json({ error: "fromAddress is required" }, { status: 400 });
  }
  if (!isCategory(category)) {
    return NextResponse.json({ error: "category must be a valid bucket" }, { status: 400 });
  }
  if (!ctx.orgId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const rule = buildSenderRule(fromAddress, category, ctx.orgId);

  // Upsert the Sender rule. If one already exists for this org + sender address,
  // update its category so the latest move wins; otherwise insert a fresh rule.
  // (No DB unique constraint to ON CONFLICT against, so we branch by hand.)
  const { data: existing } = await ctx.supabase
    .from("category_rules")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .eq("match_type", "sender_address")
    .eq("match_value", rule.match_value)
    .maybeSingle<{ id: string }>();

  if (existing) {
    const { error } = await ctx.supabase
      .from("category_rules")
      .update({ category: rule.category, is_active: true })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await ctx.supabase.from("category_rules").insert(rule);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Re-file the sender's existing inbox mail. `ilike` narrows to the sender
  // case-insensitively (stored addresses aren't normalized); the in-code
  // lowercased match is the exact re-check, and `shouldRefile` skips locked
  // and already-filed mail. Re-filed mail follows the rule (unlocked) — only
  // the email the user explicitly moved was locked by the move action.
  const { data: inboxMail } = await ctx.supabase
    .from("emails")
    .select("id, from_address, category, category_locked")
    .eq("organization_id", ctx.orgId)
    .eq("folder", "inbox")
    .ilike("from_address", rule.match_value);

  const toRefile = ((inboxMail ?? []) as Array<{
    id: string;
    from_address: string | null;
    category: string | null;
    category_locked: boolean | null;
  }>)
    .filter((e) => (e.from_address ?? "").toLowerCase() === rule.match_value)
    .filter((e) => shouldRefile(e, category))
    .map((e) => e.id);

  if (toRefile.length > 0) {
    const { error } = await ctx.supabase
      .from("emails")
      .update({ category })
      .in("id", toRefile);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ refiled: toRefile.length });
});
