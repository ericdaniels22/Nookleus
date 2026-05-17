import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const runtime = "nodejs";

// Previously ungated (read/written with the Service client, no auth
// check); now logged-in only. The caller still passes the target user id
// explicitly — behavior unchanged beyond the added 401. Recorded for the
// #78 ungated-endpoint list.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        { error: "userId query param required" },
        { status: 400 },
      );
    }
    const limit = Math.min(Number(searchParams.get("limit") ?? "15"), 100);

    const supabase = ctx.serviceClient!;

    const { data: rows, error } = await supabase
      .from("notifications")
      .select(
        "id, user_id, type, title, body, is_read, job_id, href, priority, metadata, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { count, error: cntErr } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
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
      | { id?: string; mark_all_read?: boolean; user_id?: string }
      | null;
    if (!body) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const supabase = ctx.serviceClient!;

    if (body.mark_all_read) {
      if (!body.user_id) {
        return NextResponse.json(
          { error: "user_id required when mark_all_read is true" },
          { status: 400 },
        );
      }
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", body.user_id)
        .eq("is_read", false);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.id) {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", body.id);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "body must include either { id } or { mark_all_read: true, user_id }" },
      { status: 400 },
    );
  },
);
