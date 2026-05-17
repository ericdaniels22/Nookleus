import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getStripeClient } from "@/lib/stripe";
import type { PaymentRow } from "@/lib/payments/types";

export const runtime = "nodejs";

interface Body {
  amount: number;
  reason?: string | null;
  include_reason_in_customer_email?: boolean;
  notify_customer?: boolean;
}

export const POST = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: paymentRequestId } = await params;

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 },
      );
    }

    const serviceSupabase = ctx.serviceClient!;

    // Find the most recent stripe payment row linked to this request.
    const { data: payment, error: payErr } = await serviceSupabase
      .from("payments")
      .select("id, organization_id, amount, status, stripe_charge_id, payment_request_id")
      .eq("payment_request_id", paymentRequestId)
      .eq("source", "stripe")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<
        Pick<
          PaymentRow,
          | "id"
          | "organization_id"
          | "amount"
          | "status"
          | "stripe_charge_id"
          | "payment_request_id"
        >
      >();
    if (payErr || !payment) {
      return NextResponse.json(
        { error: "no Stripe payment found on this request" },
        { status: 404 },
      );
    }
    if (!payment.stripe_charge_id) {
      return NextResponse.json(
        { error: "payment has no stripe_charge_id — cannot refund" },
        { status: 400 },
      );
    }

    // Validate amount against remaining refundable
    const { data: prevRefunds } = await serviceSupabase
      .from("refunds")
      .select("amount, status")
      .eq("payment_id", payment.id)
      .in("status", ["pending", "succeeded"]);
    const refundedSoFar = (prevRefunds ?? []).reduce(
      (s: number, r: { amount: number }) => s + Number(r.amount),
      0,
    );
    const remaining = Number(payment.amount) - refundedSoFar;
    if (body.amount - remaining > 0.01) {
      return NextResponse.json(
        {
          error: `refund exceeds remaining refundable ($${remaining.toFixed(2)})`,
        },
        { status: 400 },
      );
    }

    // Guard against double-click: if there's already a pending refund on
    // this payment, return it without creating a new Stripe refund.
    const { data: existingPending } = await serviceSupabase
      .from("refunds")
      .select("id, stripe_refund_id, status")
      .eq("payment_id", payment.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        stripe_refund_id: string | null;
        status: string;
      }>();
    if (existingPending) {
      return NextResponse.json({
        refund_id: existingPending.id,
        status: "pending",
        stripe_refund_id: existingPending.stripe_refund_id,
        note: "existing pending refund reused",
      });
    }

    // The acting user for refunded_by — resolved by the wrapper.
    const refundedBy = ctx.userId;

    // Create pending refund row FIRST so we have an ID to send to Stripe metadata.
    const { data: refundRow, error: rfErr } = await serviceSupabase
      .from("refunds")
      .insert({
        payment_id: payment.id,
        payment_request_id: paymentRequestId,
        amount: body.amount,
        reason: body.reason ?? null,
        include_reason_in_customer_email:
          body.include_reason_in_customer_email ?? false,
        notify_customer: body.notify_customer ?? true,
        refunded_by: refundedBy,
        status: "pending",
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (rfErr || !refundRow) {
      return NextResponse.json(
        { error: `failed to create refund row: ${rfErr?.message ?? ""}` },
        { status: 500 },
      );
    }

    // Call Stripe. Scope the stripe connection to the payment's org.
    const { client: stripe } = await getStripeClient(payment.organization_id);
    try {
      const stripeRefund = await stripe.refunds.create({
        charge: payment.stripe_charge_id,
        amount: Math.round(body.amount * 100),
        reason: "requested_by_customer",
        metadata: {
          refund_id: refundRow.id,
          payment_request_id: paymentRequestId,
        },
      });
      await serviceSupabase
        .from("refunds")
        .update({ stripe_refund_id: stripeRefund.id })
        .eq("id", refundRow.id);
      return NextResponse.json({
        refund_id: refundRow.id,
        status: "pending",
        stripe_refund_id: stripeRefund.id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await serviceSupabase
        .from("refunds")
        .update({ status: "failed", failure_reason: msg })
        .eq("id", refundRow.id);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  },
);
