import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

// Logged-in only (no permission key) — matches the route's prior behavior.
export const GET = withRequestContext(
  { serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const service = ctx.serviceClient!;
    const { data: expense } = await service.from("expenses").select("receipt_path").eq("id", id).maybeSingle<{ receipt_path: string | null }>();
    if (!expense?.receipt_path) return NextResponse.json({ error: "No receipt" }, { status: 404 });

    const { data, error } = await service.storage.from("receipts").createSignedUrl(expense.receipt_path, 600);
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
    return NextResponse.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + 600 * 1000).toISOString() });
  },
);
