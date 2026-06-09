import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { apiDbError } from "@/lib/api-errors";
import type { Estimate } from "@/lib/types";

// Creation moved to POST /api/estimates/create-with-template (#571) — the
// create_estimate_with_template DB function is the single create path.

export const GET = withRequestContext(
  { permission: "view_estimates" },
  async (request, { supabase }) => {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("job_id");
    if (!jobId) return NextResponse.json({ error: "job_id query param required" }, { status: 400 });

    const { data, error } = await supabase
      .from("estimates")
      .select("*")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("sequence_number", { ascending: true })
      .returns<Estimate[]>();
    if (error) return apiDbError(error.message, "GET /api/estimates list");

    return NextResponse.json({ estimates: data ?? [] });
  },
);
