import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

export const runtime = "nodejs";

export const GET = withRequestContext(
  { permission: "view_billing", serviceClient: true },
  async (_req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const supabase = ctx.serviceClient!;
    const { data: payment } = await supabase
      .from("payments")
      .select("id, amount")
      .eq("payment_request_id", id)
      .eq("source", "stripe")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; amount: number }>();
    if (!payment) {
      return NextResponse.json({ error: "no Stripe payment" }, { status: 404 });
    }
    const { data: refunds } = await supabase
      .from("refunds")
      .select("amount, status")
      .eq("payment_id", payment.id)
      .in("status", ["pending", "succeeded"]);
    const refundedSum = (refunds ?? []).reduce(
      (s: number, r: { amount: number }) => s + Number(r.amount),
      0,
    );
    const remaining = Number(payment.amount) - refundedSum;
    return NextResponse.json({ remaining, payment_id: payment.id });
  },
);
