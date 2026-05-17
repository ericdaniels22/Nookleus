import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const GET = withRequestContext(
  { permission: "view_billing", serviceClient: true },
  async (_req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { data, error } = await ctx.serviceClient!
      .from("payment_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ payment_request: data });
  },
);
