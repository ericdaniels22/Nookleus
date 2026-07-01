import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";
import { writePaymentEvent } from "@/lib/payments/activity";
import type { PaymentRequestRow } from "@/lib/payments/types";
import { Lock, CheckCircle2 } from "lucide-react";
import MethodSelector from "./method-selector";
import { formatUsd } from "@/lib/payments/merge-fields";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string | null;
}

const EMPTY_BRAND: CompanyBrand = {
  name: "",
  phone: "",
  email: "",
  address: "",
  logoUrl: null,
};

// Multi-tenant rule (18c): branding is scoped to the payment request's
// organization_id. There is intentionally no AAA fallback. When orgId is
// null (token didn't verify, or PR row not found) we render the error shell
// with no branding rather than misattribute the link to AAA.
async function loadCompany(orgId: string | null): Promise<CompanyBrand> {
  if (!orgId) return EMPTY_BRAND;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", orgId)
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [
      r.key,
      r.value,
    ]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    address: m.get("address") || "",
    logoUrl: m.get("logo_url") || null,
  };
}

interface JobRow {
  id: string;
  job_number: string | null;
  property_address: string | null;
  contact_id: string | null;
}
interface StripeConnectionRow {
  ach_enabled: boolean;
  card_enabled: boolean;
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
  ach_preferred_threshold: number | null;
}
interface FeeDisclosureRow {
  fee_disclosure_text: string | null;
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. Validate JWT signature + expiry
  let payload: { payment_request_id: string; job_id: string };
  try {
    payload = verifyPaymentLinkToken(token);
  } catch (e) {
    const reason =
      e instanceof InvalidPaymentLinkTokenError ? e.message : "Invalid link";
    return (
      <ErrorShell
        title="This payment link is invalid"
        subtitle={reason}
        company={EMPTY_BRAND}
      />
    );
  }

  // Fetch the payment request first; branding is then scoped to its
  // organization_id. Service-role bypasses RLS — the link_token in the JWT
  // is the credential.
  const supabase = createServiceClient();
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", payload.payment_request_id)
    .maybeSingle<PaymentRequestRow>();

  const company = await loadCompany(pr?.organization_id ?? null);

  // 2. Request-level status checks
  if (!pr) {
    return (
      <ErrorShell
        title="Payment request not found"
        subtitle="This link is no longer valid."
        company={company}
      />
    );
  }
  if (pr.link_token !== token) {
    return (
      <ErrorShell
        title="This link has been replaced"
        subtitle="A newer payment link was sent for this request. Check your most recent email from the sender."
        company={company}
      />
    );
  }
  if (pr.status === "voided") {
    return (
      <ErrorShell
        title="This payment request has been cancelled"
        subtitle="Contact the sender if you believe this is an error."
        company={company}
      />
    );
  }
  if (pr.status === "paid") {
    return <PaidShell pr={pr} company={company} />;
  }
  if (pr.status === "refunded" || pr.status === "partially_refunded") {
    return (
      <ErrorShell
        title="This payment was refunded"
        subtitle="Contact the sender for details."
        company={company}
      />
    );
  }
  if (
    pr.link_expires_at &&
    new Date(pr.link_expires_at).getTime() < Date.now()
  ) {
    await supabase
      .from("payment_requests")
      .update({ status: "expired" })
      .eq("id", pr.id)
      .eq("status", pr.status);
    return (
      <ErrorShell
        title="This payment link has expired"
        subtitle="Contact the sender to have a fresh link issued."
        company={company}
      />
    );
  }

  // 3. Load job + stripe connection for the payment card UI. Both
  //    stripe_connection and payment_email_settings are per-org tables
  //    (post-18a multi-tenant); scope by pr.organization_id rather than
  //    selecting the first row (which would mis-resolve under multi-org).
  const [{ data: job }, { data: stripeConn }, { data: settingsRow }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id, job_number, property_address, contact_id")
        .eq("id", pr.job_id)
        .maybeSingle<JobRow>(),
      supabase
        .from("stripe_connection")
        .select(
          "ach_enabled, card_enabled, pass_card_fee_to_customer, card_fee_percent, ach_preferred_threshold",
        )
        .eq("organization_id", pr.organization_id)
        .maybeSingle<StripeConnectionRow>(),
      supabase
        .from("payment_email_settings")
        .select("fee_disclosure_text")
        .eq("organization_id", pr.organization_id)
        .maybeSingle<FeeDisclosureRow>(),
    ]);

  if (!stripeConn) {
    return (
      <ErrorShell
        title="Payments are temporarily unavailable"
        subtitle="Our payment processor is not currently connected. Please contact us directly."
        company={company}
      />
    );
  }

  // 4. First-view logging + status transition sent → viewed
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    null;
  const ua = h.get("user-agent");
  if (!pr.first_viewed_at) {
    await writePaymentEvent(supabase, {
      paymentRequestId: pr.id,
      eventType: "link_viewed",
      ipAddress: ip,
      userAgent: ua,
    });
    await supabase
      .from("payment_requests")
      .update({
        first_viewed_at: new Date().toISOString(),
        last_viewed_at: new Date().toISOString(),
        status: pr.status === "sent" ? "viewed" : pr.status,
      })
      .eq("id", pr.id);
  } else {
    await supabase
      .from("payment_requests")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", pr.id);
  }

  // 5. Decide which payment methods to offer
  const amount = Number(pr.amount);
  const thresholdApplies =
    stripeConn.ach_preferred_threshold != null &&
    amount >= Number(stripeConn.ach_preferred_threshold) &&
    stripeConn.ach_enabled;

  const methods = {
    ach: stripeConn.ach_enabled,
    card: stripeConn.card_enabled && !thresholdApplies,
  };

  const cardFeeAmount =
    stripeConn.pass_card_fee_to_customer && methods.card
      ? Math.round(
          amount * (Number(stripeConn.card_fee_percent) / 100) * 100,
        ) / 100
      : null;

  return (
    <div className="min-h-dvh py-10 px-4">
      <div className="max-w-xl mx-auto">
        <HeaderBlock company={company} />

        <div className="public-card p-6 space-y-4">
          <div className="text-xs public-muted uppercase tracking-wider">
            {job?.job_number ? `Job ${job.job_number} · ` : ""}
            Payment to {company.name || "our company"}
          </div>
          <h1
            className="text-lg font-semibold"
            style={{ color: "#111827" }}
          >
            {pr.title}
          </h1>
          <div
            className="text-4xl font-bold"
            style={{ color: "#111827" }}
          >
            {formatUsd(amount) ?? `$${amount.toFixed(2)}`}
          </div>
          {job?.property_address && (
            <div className="text-sm public-muted">
              {job.property_address}
            </div>
          )}

          <MethodSelector
            token={token}
            showAch={methods.ach}
            showCard={methods.card}
            cardFeeFormatted={formatUsd(cardFeeAmount)}
            passCardFee={stripeConn.pass_card_fee_to_customer}
            thresholdApplied={thresholdApplies}
            feeDisclosure={settingsRow?.fee_disclosure_text ?? null}
          />
        </div>

        <FooterBlock company={company} />
      </div>
    </div>
  );
}

// -------------------- status shells --------------------

function HeaderBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mb-6">
      <div className="flex items-start gap-3">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg"
          />
        ) : null}
        <div className="flex-1">
          <div
            className="text-lg font-semibold"
            style={{ color: "#111827" }}
          >
            {company.name || "Payment"}
          </div>
          {(company.phone || company.email) && (
            <div className="text-sm public-muted">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs public-muted">
          <Lock size={12} />
          Secure payment powered by Stripe
        </div>
      </div>
    </div>
  );
}

function FooterBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mt-6 text-[11px] text-center public-muted space-y-1">
      {company.address && <div>{company.address}</div>}
      {(company.phone || company.email) && (
        <div>
          Questions? Contact
          {company.email && <> {company.email}</>}
          {company.phone && <> · {company.phone}</>}
        </div>
      )}
    </div>
  );
}

function ErrorShell({
  title,
  subtitle,
  company,
}: {
  title: string;
  subtitle: string;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt=""
            className="w-12 h-12 object-contain rounded-lg mx-auto mb-4"
          />
        ) : null}
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          {title}
        </h1>
        <p className="text-sm public-muted mb-6">{subtitle}</p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            Contact {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}

function PaidShell({
  pr,
  company,
}: {
  pr: PaymentRequestRow;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <CheckCircle2
          size={48}
          className="mx-auto mb-3"
          style={{ color: "#0f6e56" }}
        />
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          Payment already received — thank you
        </h1>
        <p className="text-sm public-muted mb-6">
          We received your payment of {formatUsd(Number(pr.amount))} for{" "}
          {pr.title}. A receipt has been emailed.
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}
