import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getStripeClient } from "@/lib/stripe";

export const POST = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };

    const supabase = ctx.serviceClient!;
    const { data: pr, error } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!pr) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (pr.status === "paid") {
      return NextResponse.json({ error: "cannot_void_paid" }, { status: 400 });
    }
    if (pr.status === "voided") {
      return NextResponse.json({ payment_request: pr });
    }

    if (pr.stripe_checkout_session_id) {
      try {
        const { client } = await getStripeClient(pr.organization_id);
        await client.checkout.sessions.expire(pr.stripe_checkout_session_id);
      } catch {
        // Session may already be expired or Stripe may be temporarily unreachable.
        // Proceed with the DB-side void anyway — the session is best-effort cleanup.
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("payment_requests")
      .update({
        status: "voided",
        voided_at: new Date().toISOString(),
        voided_by: ctx.userId,
        void_reason: body.reason ?? null,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Recompute parent flags.
    const { data: remainingForJob } = await supabase
      .from("payment_requests")
      .select("id, status")
      .eq("job_id", pr.job_id)
      .in("status", ["draft", "sent", "viewed"]);
    const jobStillPending = (remainingForJob ?? []).length > 0;
    const { error: jobFlagErr } = await supabase
      .from("jobs")
      .update({ has_pending_payment_request: jobStillPending })
      .eq("id", pr.job_id);
    if (jobFlagErr) {
      console.error("[payment-requests/void] failed to recompute jobs flag:", {
        job_id: pr.job_id,
        payment_request_id: id,
        error: jobFlagErr.message,
      });
    }

    if (pr.invoice_id) {
      const { data: remainingForInvoice } = await supabase
        .from("payment_requests")
        .select("id, status")
        .eq("invoice_id", pr.invoice_id)
        .not("status", "in", "(voided,expired,failed,refunded)");
      const invoiceStillLinked = (remainingForInvoice ?? []).length > 0;
      const { error: invFlagErr } = await supabase
        .from("invoices")
        .update({ has_payment_request: invoiceStillLinked })
        .eq("id", pr.invoice_id);
      if (invFlagErr) {
        console.error("[payment-requests/void] failed to recompute invoices flag:", {
          invoice_id: pr.invoice_id,
          payment_request_id: id,
          error: invFlagErr.message,
        });
      }
    }

    return NextResponse.json({ payment_request: updated });
  },
);
