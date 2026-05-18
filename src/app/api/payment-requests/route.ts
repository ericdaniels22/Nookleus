import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getStripeClient, StripeNotConnectedError } from "@/lib/stripe";
import { generatePaymentLinkToken } from "@/lib/payment-link-tokens";

interface CreateBody {
  job_id: string;
  invoice_id?: string | null;
  request_type: "invoice" | "deposit" | "retainer" | "partial";
  title: string;
  amount: number;
  link_expiry_days?: number;
  allow_card?: boolean;
  allow_ach?: boolean;
  payer_email?: string | null;
  payer_name?: string | null;
}

const DEFAULT_EXPIRY_DAYS = 14;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const POST = withRequestContext(
  { permission: "record_payments", serviceClient: true },
  async (req, ctx) => {
    const body = (await req.json()) as CreateBody;

    if (!body.job_id || !body.title || typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const validTypes: CreateBody["request_type"][] = ["invoice", "deposit", "retainer", "partial"];
    if (!validTypes.includes(body.request_type)) {
      return NextResponse.json({ error: "invalid_request_type" }, { status: 400 });
    }

    // Amount must be representable as whole cents (2 decimal places at most).
    const scaled = Math.round(body.amount * 100);
    if (Math.abs(scaled / 100 - body.amount) > 1e-9) {
      return NextResponse.json({ error: "amount_precision" }, { status: 400 });
    }

    const orgId = ctx.orgId;
    if (!orgId) {
      return NextResponse.json({ error: "no_active_organization" }, { status: 401 });
    }

    let stripeCtx: Awaited<ReturnType<typeof getStripeClient>>;
    try {
      stripeCtx = await getStripeClient(orgId);
    } catch (e) {
      if (e instanceof StripeNotConnectedError) {
        return NextResponse.json({ error: "stripe_not_connected" }, { status: 400 });
      }
      throw e;
    }
    const { client: stripe, connection } = stripeCtx;

    const supabase = ctx.serviceClient!;

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, contact_id, job_number")
      .eq("id", body.job_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (jobErr || !job) return NextResponse.json({ error: "job_not_found" }, { status: 404 });

    let customerEmail: string | null = null;
    let customerName: string | null = null;
    if (job.contact_id) {
      const { data: contact } = await supabase
        .from("contacts")
        .select("email, full_name")
        .eq("id", job.contact_id)
        .maybeSingle();
      if (contact) {
        customerEmail = contact.email ?? null;
        customerName = contact.full_name?.trim() || null;
      }
    }

    // Caller-supplied override wins over the contact lookup. Lets the user
    // send a payment request to a different address without editing the
    // contact record.
    if (typeof body.payer_email === "string") {
      const trimmed = body.payer_email.trim();
      if (trimmed) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return NextResponse.json({ error: "invalid_payer_email" }, { status: 400 });
        }
        customerEmail = trimmed;
      }
    }
    if (typeof body.payer_name === "string") {
      customerName = body.payer_name.trim() || customerName;
    }

    if (body.invoice_id) {
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id, job_id, total_amount")
        .eq("id", body.invoice_id)
        .maybeSingle();
      if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
      if (invoice.job_id !== body.job_id) {
        return NextResponse.json({ error: "invoice_job_mismatch" }, { status: 400 });
      }
      const { data: payments } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", body.invoice_id);
      const paid = (payments ?? [])
        .filter((p) => p.status === "received")
        .reduce((acc: number, p: { amount: number }) => acc + Number(p.amount), 0);
      const balance = Number(invoice.total_amount) - paid;
      if (body.amount > balance + 0.005) {
        return NextResponse.json({ error: "amount_exceeds_balance" }, { status: 400 });
      }
    }

    let allowCard = body.allow_card ?? connection.card_enabled;
    const allowAch = body.allow_ach ?? connection.ach_enabled;
    if (
      connection.ach_preferred_threshold != null &&
      body.amount >= Number(connection.ach_preferred_threshold) &&
      connection.ach_enabled
    ) {
      allowCard = false;
    }
    if (!allowCard && !allowAch) {
      return NextResponse.json({ error: "no_payment_methods_available" }, { status: 400 });
    }

    const paymentMethodTypes: ("card" | "us_bank_account")[] = [];
    if (allowCard && connection.card_enabled) paymentMethodTypes.push("card");
    if (allowAch && connection.ach_enabled) paymentMethodTypes.push("us_bank_account");

    const paymentRequestId = crypto.randomUUID();
    const expiryDays = body.link_expiry_days ?? DEFAULT_EXPIRY_DAYS;
    const linkExpiresAt = addDays(new Date(), expiryDays);

    // Stripe Checkout Sessions expire at most 24 hours after creation. Our
    // payment link token may outlive the session — in Build 17b, /pay/[token]
    // will regenerate a fresh session when a valid token arrives after the
    // session has expired. Here we cap at 23.5h to stay safely under Stripe's
    // limit. Do NOT raise this cap without addressing the Stripe API contract.
    const STRIPE_SESSION_MAX_MS = 23.5 * 60 * 60 * 1000;
    const stripeSessionExpiresAt = new Date(
      Math.min(linkExpiresAt.getTime(), Date.now() + STRIPE_SESSION_MAX_MS),
    );

    const token = generatePaymentLinkToken({
      paymentRequestId,
      jobId: body.job_id,
      expiresAt: linkExpiresAt,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: { name: body.title },
            unit_amount: Math.round(body.amount * 100),
          },
        },
      ],
      metadata: {
        organization_id: orgId,
        payment_request_id: paymentRequestId,
        job_id: body.job_id,
        invoice_id: body.invoice_id ?? "",
        request_type: body.request_type,
      },
      payment_intent_data: {
        metadata: {
          organization_id: orgId,
          payment_request_id: paymentRequestId,
          job_id: body.job_id,
          invoice_id: body.invoice_id ?? "",
          request_type: body.request_type,
        },
        statement_descriptor_suffix:
          connection.default_statement_descriptor?.slice(0, 22) || undefined,
        // 17c — intentionally NOT setting receipt_email. Our webhook handler
        // sends a branded receipt email with a PDF attached. To prevent
        // Stripe from also sending its default receipt, disable the
        // "Successful payments" email in Stripe Dashboard → Settings →
        // Emails (applies account-wide).
      },
      customer_email: customerEmail ?? undefined,
      success_url: `${appUrl}/pay/${token}/success`,
      cancel_url: `${appUrl}/pay/${token}`,
      expires_at: Math.floor(stripeSessionExpiresAt.getTime() / 1000),
    });

    const { data: inserted, error: insertErr } = await supabase
      .from("payment_requests")
      .insert({
        organization_id: orgId,
        id: paymentRequestId,
        job_id: body.job_id,
        invoice_id: body.invoice_id ?? null,
        request_type: body.request_type,
        title: body.title,
        amount: body.amount,
        status: "draft",
        stripe_checkout_session_id: session.id,
        link_token: token,
        link_expires_at: linkExpiresAt.toISOString(),
        payer_email: customerEmail,
        payer_name: customerName,
        sent_by: ctx.userId,
      })
      .select("*")
      .maybeSingle();
    if (insertErr) {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch {
        /* best-effort cleanup */
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    const { error: jobFlagErr } = await supabase
      .from("jobs")
      .update({ has_pending_payment_request: true })
      .eq("id", body.job_id);
    if (jobFlagErr) {
      console.error(
        "[payment-requests] failed to set jobs.has_pending_payment_request:",
        { job_id: body.job_id, payment_request_id: paymentRequestId, error: jobFlagErr.message },
      );
    }
    if (body.invoice_id) {
      const { error: invFlagErr } = await supabase
        .from("invoices")
        .update({ has_payment_request: true })
        .eq("id", body.invoice_id);
      if (invFlagErr) {
        console.error(
          "[payment-requests] failed to set invoices.has_payment_request:",
          { invoice_id: body.invoice_id, payment_request_id: paymentRequestId, error: invFlagErr.message },
        );
      }
    }

    return NextResponse.json({ payment_request: inserted });
  },
);

export const GET = withRequestContext(
  { permission: "view_billing", serviceClient: true },
  async (req, ctx) => {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    if (!jobId) return NextResponse.json({ error: "job_id_required" }, { status: 400 });

    const { data, error } = await ctx.serviceClient!
      .from("payment_requests")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ payment_requests: data });
  },
);
