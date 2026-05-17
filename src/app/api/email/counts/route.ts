import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/email/counts?accountId=... — get unread counts per folder.
// Previously ungated (relied on RLS via the User client); now logged-in
// only. Recorded for the #78 ungated-endpoint list.
export const GET = withRequestContext({}, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId"); // null = all accounts

  const folders = ["inbox", "sent", "drafts", "trash", "spam", "archive"];
  const counts: Record<string, { total: number; unread: number }> = {};

  for (const folder of folders) {
    let totalQuery = ctx.supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("folder", folder);

    let unreadQuery = ctx.supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .eq("folder", folder)
      .eq("is_read", false);

    if (accountId) {
      totalQuery = totalQuery.eq("account_id", accountId);
      unreadQuery = unreadQuery.eq("account_id", accountId);
    }

    const [totalResult, unreadResult] = await Promise.all([totalQuery, unreadQuery]);

    counts[folder] = {
      total: totalResult.count || 0,
      unread: unreadResult.count || 0,
    };
  }

  // Starred count (across all folders)
  let starredQuery = ctx.supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("is_starred", true);

  if (accountId) {
    starredQuery = starredQuery.eq("account_id", accountId);
  }

  const starredResult = await starredQuery;
  counts.starred = { total: starredResult.count || 0, unread: 0 };

  // Category unread counts for inbox only
  let categoryQuery = ctx.supabase
    .from("emails")
    .select("category")
    .eq("folder", "inbox")
    .eq("is_read", false);

  if (accountId) {
    categoryQuery = categoryQuery.eq("account_id", accountId);
  }

  const { data: categoryData } = await categoryQuery;

  const categoryUnread: Record<string, number> = {
    general: 0,
    promotions: 0,
    social: 0,
    purchases: 0,
    starred: 0,
  };

  for (const row of (categoryData || []) as { category: string | null }[]) {
    const cat = row.category || "general";
    if (cat in categoryUnread) categoryUnread[cat]++;
  }

  // Starred count for the inbox tab (total, not unread — starred status is
  // independent of read state and users want to see the full set).
  let starredInboxQuery = ctx.supabase
    .from("emails")
    .select("id", { count: "exact", head: true })
    .eq("folder", "inbox")
    .eq("is_starred", true);

  if (accountId) {
    starredInboxQuery = starredInboxQuery.eq("account_id", accountId);
  }

  const starredInboxResult = await starredInboxQuery;
  categoryUnread.starred = starredInboxResult.count || 0;

  return NextResponse.json({ ...counts, categoryUnread });
});
