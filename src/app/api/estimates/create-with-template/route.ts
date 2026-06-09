import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// POST /api/estimates/create-with-template (#571) — the one create path for
// Estimates. Delegates to the create_estimate_with_template DB function:
// default-title resolution, atomic numbering, draft insert, optional template
// apply + totals recompute, all in a single transaction. Gated on
// `create_estimates` (the stronger create gate — it both creates and applies).

interface PostBody {
  job_id?: string;
  title?: string | null;
  template_id?: string | null;
}

export const POST = withRequestContext(
  { permission: "create_estimates" },
  async (request, { supabase }) => {
    const body = (await request.json().catch(() => null)) as PostBody | null;
    if (!body || typeof body.job_id !== "string") {
      return NextResponse.json({ error: "job_id required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("create_estimate_with_template", {
      p_job_id: body.job_id,
      p_title: body.title ?? null,
      p_template_id: body.template_id ?? null,
    });
    if (error) {
      // The DB function raises bare tokens (house style, like
      // apply_template_to_estimate) — map the expected ones to statuses and
      // surface anything else as a 500.
      const m = error.message ?? "";
      if (m.includes("job_not_found")) {
        return NextResponse.json({ error: "job_not_found" }, { status: 404 });
      }
      if (m.includes("template_not_found_or_inactive")) {
        return NextResponse.json(
          { error: "template_not_found_or_inactive" },
          { status: 404 },
        );
      }
      return NextResponse.json({ error: m }, { status: 500 });
    }

    return NextResponse.json({ id: data as string }, { status: 201 });
  },
);
