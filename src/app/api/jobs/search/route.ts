import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/jobs/search?q=...&limit=10
// Previously ungated (RLS-only); now logged-in only via `withRequestContext`.
export const GET = withRequestContext({}, async (request, ctx) => {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").replace(/[%,.*()]/g, "");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10") || 10, 1), 50);

  let query = ctx.supabase
    .from("jobs")
    .select("id, job_number, property_address")
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (q) {
    query = query.or(
      `job_number.ilike.%${q}%,property_address.ilike.%${q}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data || [] });
});
