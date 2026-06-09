import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// GET /api/estimates/default-title (#571) — the Organization's standard
// Estimate title, for seeding the New Estimate modal's name field. The same
// waterfall lives in the create_estimate_with_template DB function for blank
// submissions; this endpoint only exists so the estimator can SEE and edit
// the default before creating. Gated on `create_estimates` (its one
// consumer is the create modal).

export const GET = withRequestContext(
  { permission: "create_estimates" },
  async (_request, { supabase, orgId }) => {
    const { data: setting } = await supabase
      .from("company_settings")
      .select("value")
      .eq("organization_id", orgId)
      .eq("key", "default_estimate_title")
      .maybeSingle<{ value: string | null }>();

    return NextResponse.json({ title: setting?.value?.trim() || "Estimate" });
  },
);
