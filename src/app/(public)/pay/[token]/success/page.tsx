import { CheckCircle2 } from "lucide-react";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  logoUrl: string | null;
}

const EMPTY_BRAND: CompanyBrand = {
  name: "",
  phone: "",
  email: "",
  logoUrl: null,
};

// Multi-tenant rule (18c): branding is scoped to the payment request's
// organization_id. There is intentionally no AAA fallback. When orgId is
// null (token didn't verify, or PR row not found) we render the success
// page with no branding rather than misattribute it to AAA.
async function loadCompany(orgId: string | null): Promise<CompanyBrand> {
  if (!orgId) return EMPTY_BRAND;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", orgId)
    .in("key", ["company_name", "phone", "email", "logo_url"]);
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
    logoUrl: m.get("logo_url") || null,
  };
}

export default async function PaySuccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Decode token to derive payment_request_id, then look up the request to
  // get its organization_id. Token-verify failures don't render an error
  // page here — the customer may have successfully paid, which can consume
  // the link's window. We just fall back to no branding.
  let orgId: string | null = null;
  try {
    const payload = verifyPaymentLinkToken(token);
    const supabase = createServiceClient();
    const { data: pr } = await supabase
      .from("payment_requests")
      .select("organization_id")
      .eq("id", payload.payment_request_id)
      .maybeSingle<{ organization_id: string }>();
    orgId = pr?.organization_id ?? null;
  } catch (e) {
    if (!(e instanceof InvalidPaymentLinkTokenError)) throw e;
  }

  const company = await loadCompany(orgId);

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg mx-auto mb-4"
          />
        ) : null}
        <CheckCircle2
          size={48}
          className="mx-auto mb-3"
          style={{ color: "#0f6e56" }}
        />
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          Payment submitted
        </h1>
        <p className="text-sm public-muted mb-6">
          Thank you &mdash; we&apos;ll send a receipt by email shortly. You can
          close this page.
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
