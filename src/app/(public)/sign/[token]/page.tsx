import { headers } from "next/headers";
import { Lock } from "lucide-react";
import ContractSignerView from "@/components/contracts/contract-signer-view";
import type { PublicSigningView } from "@/lib/contracts/types";

// Error codes returned by GET /api/sign/[token] that need human-readable labels.
type ApiErrorCode =
  | "invalid_token"
  | "stale_token"
  | "expired"
  | "voided"
  | "not_found"
  | "signer_not_found"
  | "template_not_found";

interface ErrorInfo {
  title: string;
  subtitle: string;
}

function errorInfoFor(code: string | undefined): ErrorInfo {
  switch (code as ApiErrorCode) {
    case "invalid_token":
      return {
        title: "This link is invalid",
        subtitle: "The signing link could not be verified. Check that you copied it correctly.",
      };
    case "stale_token":
      return {
        title: "This link has been replaced",
        subtitle:
          "A newer signing link was sent for this contract. Check your most recent email from the sender.",
      };
    case "expired":
      return {
        title: "This signing link has expired",
        subtitle: "Contact the sender to have a fresh link issued.",
      };
    case "voided":
      return {
        title: "This contract has been voided",
        subtitle: "Contact the sender if you believe this is an error.",
      };
    default:
      return {
        title: "Document not found",
        subtitle: "This signing link is no longer valid.",
      };
  }
}

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  logo_url: string | null;
}

const EMPTY_BRAND: CompanyBrand = { name: "", phone: "", email: "", logo_url: null };

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Resolve absolute URL for server-side fetch to our own API.
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const apiUrl = `${proto}://${host}/api/sign/${token}`;

  // Forward any cookies so the API route can set the view-dedup cookie.
  const cookieHeader = h.get("cookie") ?? "";

  let view: PublicSigningView | null = null;
  let errorCode: string | undefined;

  try {
    const res = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        cookie: cookieHeader,
        "x-forwarded-for": h.get("x-forwarded-for") ?? "",
        "x-real-ip": h.get("x-real-ip") ?? "",
        "user-agent": h.get("user-agent") ?? "",
      },
    });

    if (res.ok) {
      view = (await res.json()) as PublicSigningView;
    } else {
      const body = await res.json().catch(() => ({})) as { error?: string };
      errorCode = body.error;
    }
  } catch {
    errorCode = "not_found";
  }

  // Error path — no view available.
  if (!view) {
    const info = errorInfoFor(errorCode);
    return <ErrorShell title={info.title} subtitle={info.subtitle} company={EMPTY_BRAND} />;
  }

  // Branding from the view the API already loaded.
  const company: CompanyBrand = {
    name: view.company.name,
    phone: view.company.phone,
    email: view.company.email,
    logo_url: view.company.logo_url,
  };

  // Already-signed short-circuit.
  if (view.contract.status === "signed") {
    return <SignedShell view={view} company={company} />;
  }

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <HeaderBlock company={company} />
        <ContractSignerView view={view} signToken={token} />
        <AuditFooter />
      </div>
    </div>
  );
}

// ---------- Status shells ----------

function HeaderBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mb-6">
      <div className="flex items-start gap-3">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg"
          />
        ) : null}
        <div className="flex-1">
          <div className="text-lg font-semibold" style={{ color: "#111827" }}>
            {company.name || "Contract Signing"}
          </div>
          {(company.phone || company.email) && (
            <div className="text-sm public-muted">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs public-muted">
          <Lock size={12} />
          Secure signing powered by AAA Platform
        </div>
      </div>
    </div>
  );
}

function AuditFooter() {
  return (
    <p className="text-[11px] text-center public-muted mt-6">
      This signing session is secure · IP logged for audit purposes · Document hash verified
    </p>
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2" style={{ color: "#111827" }}>
          {title}
        </h1>
        <p className="text-sm public-muted mb-6">{subtitle}</p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            Contact the sender: {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}

function SignedShell({
  view,
  company,
}: {
  view: PublicSigningView;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2" style={{ color: "#111827" }}>
          This contract has been signed
        </h1>
        <p className="text-sm public-muted mb-6">
          {view.contract.title} — signed{" "}
          {view.contract.signed_at
            ? new Date(view.contract.signed_at).toLocaleDateString()
            : ""}
          .
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
          </div>
        )}
      </div>
    </div>
  );
}
