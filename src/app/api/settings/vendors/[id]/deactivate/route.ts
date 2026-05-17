import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const POST = withRequestContext(
  { permission: "manage_vendors", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { error } = await ctx
      .serviceClient!.from("vendors")
      .update({ is_active: false })
      .eq("id", id)
      .eq("organization_id", ctx.orgId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  },
);
