import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const runtime = "nodejs";

// Logged-in only — notifications are per-user, not role-gated. The target
// user is the authenticated caller (`ctx.userId`): the route reads/writes
// with the Service client (RLS bypassed), so it must never trust a
// client-supplied user id. See #119.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "15"), 100);

    const supabase = ctx.serviceClient!;

    const { data: rows, error } = await supabase
      .from("notifications")
      .select(
        "id, user_id, type, title, body, is_read, job_id, href, priority, metadata, created_at",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { count, error: cntErr } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId)
      .eq("is_read", false);
    if (cntErr)
      return NextResponse.json({ error: cntErr.message }, { status: 500 });

    return NextResponse.json({
      notifications: rows ?? [],
      unread_count: count ?? 0,
    });
  },
);

export const PATCH = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as
      | { id?: string; mark_all_read?: boolean }
      | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const supabase = ctx.serviceClient!;

    if (body.mark_all_read) {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", ctx.userId)
        .eq("is_read", false);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.id) {
      // Scope the update to the caller and read back the affected row: a
      // notification that does not belong to the caller (or does not exist)
      // matches nothing and is indistinguishable from a missing one — 404.
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", body.id)
        .eq("user_id", ctx.userId)
        .select("id");
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) {
        return NextResponse.json(
          { error: "notification not found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "body must include either { id } or { mark_all_read: true }" },
      { status: 400 },
    );
  },
);
