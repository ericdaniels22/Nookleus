import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// Logged-in only (no permission key) — matches the route's prior behavior.
// Reads expenses with the Service client; org-scoping of this query is a
// known pre-existing gap, tracked for the #86 ungated-endpoint follow-up
// and intentionally not changed by this conversion.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ jobId: string }> }) => {
    const { jobId } = await params;
    const { data, error } = await ctx.serviceClient!.from("expenses")
      .select(`
        *,
        vendor:vendors!vendor_id(id, name, vendor_type),
        category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
      `)
      .eq("job_id", jobId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  },
);
