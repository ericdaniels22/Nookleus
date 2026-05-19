import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { belongsToActiveOrganization } from "@/lib/request-context/belongs-to-active-organization";

// Logged-in only (no permission key) — matches the route's prior behavior.
// Reads expenses with the Service client (RLS bypassed): the guard rejects
// an activity id from another Organization with 404 before the read.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ activityId: string }> }) => {
    const { activityId } = await params;
    const service = ctx.serviceClient!;
    if (
      !(await belongsToActiveOrganization(
        service,
        { table: "job_activities", id: activityId },
        ctx.orgId,
      ))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data, error } = await service.from("expenses")
      .select(`
        *,
        vendor:vendors!vendor_id(id, name, vendor_type),
        category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
      `)
      .eq("activity_id", activityId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data);
  },
);
