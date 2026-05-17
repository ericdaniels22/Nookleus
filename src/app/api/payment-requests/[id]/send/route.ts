import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { sendPaymentRequestEmail } from "@/lib/payment-emails";

export const POST = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (_req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = ctx.serviceClient!;
    const { data: pr, error } = await supabase
      .from("payment_requests")
      .select("id, status")
      .eq("id", id)
      .maybeSingle<{ id: string; status: string }>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!pr) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (pr.status !== "draft") {
      return NextResponse.json(
        { error: `cannot_send_from_status_${pr.status}` },
        { status: 400 },
      );
    }

    try {
      const sent = await sendPaymentRequestEmail(id);
      const { data: updated } = await supabase
        .from("payment_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      return NextResponse.json({ payment_request: updated, message_id: sent.messageId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `send_failed: ${msg}` },
        { status: 502 },
      );
    }
  },
);
