import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { belongsToActiveOrganization } from "@/lib/request-context/belongs-to-active-organization";

// Logged-in only (no permission key) — matches the route's prior behavior.
// Reads expenses with the Service client (RLS bypassed), so the route is
// responsible for the tenant scoping the database would otherwise do: the
// guard rejects a job id from another Organization with 404 before the read.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ jobId: string }> }) => {
    const { jobId } = await params;
    const service = ctx.serviceClient!;
    if (!(await belongsToActiveOrganization(service, { jobId }, ctx.orgId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { data, error } = await service.from("expenses")
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
