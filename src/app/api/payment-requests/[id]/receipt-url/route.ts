import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const runtime = "nodejs";

export const GET = withRequestContext(
  { permission: "view_billing", serviceClient: true },
  async (_req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const supabase = ctx.serviceClient!;
    const { data: pr } = await supabase
      .from("payment_requests")
      .select("receipt_pdf_path")
      .eq("id", id)
      .maybeSingle<{ receipt_pdf_path: string | null }>();
    if (!pr?.receipt_pdf_path) {
      return NextResponse.json({ error: "no receipt PDF" }, { status: 404 });
    }

    const { data, error } = await supabase.storage
      .from("receipts")
      .createSignedUrl(pr.receipt_pdf_path, 300);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "signed URL failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ url: data.signedUrl });
  },
);
