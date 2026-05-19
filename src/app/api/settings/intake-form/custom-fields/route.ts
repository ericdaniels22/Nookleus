import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/settings/intake-form/custom-fields?jobId=xxx
// Requires `access_settings` (#107) — tightened from the logged-in-only #84 gate.
export const GET = withRequestContext({ permission: "access_settings" }, async (request, ctx) => {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("job_custom_fields")
    .select("*")
    .eq("job_id", jobId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
});
