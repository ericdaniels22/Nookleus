import { Lock } from "lucide-react";
import { createServiceClient } from "@/lib/supabase-api";
import { buildPublicSigningViewByToken } from "@/lib/contracts/build-public-signing-view";
import { writeContractEvent } from "@/lib/contracts/audit";
import { headers } from "next/headers";
import type { PublicSigningView } from "@/lib/contracts/types";
import SignedRedirectWrapper from "./signed-redirect-wrapper";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  logo_url: string | null;
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceClient();

  const result = await buildPublicSigningViewByToken(supabase, token);

  // Error path — render an appropriate ErrorShell with no branding (we
  // don't have the org context for invalid/missing tokens).
  if (!result.ok) {
    const info = errorInfoFor(result.error);
    const emptyBrand: CompanyBrand = { name: "", phone: "", email: "", logo_url: null };
    return <ErrorShell title={info.title} subtitle={info.subtitle} company={emptyBrand} />;
  }

  const { view, contract, signer } = result;

  // Page-level audit. Per review: simplest correct behavior is one
  // `link_viewed` per page render — duplicates on reload are acceptable
  // (this is how it worked pre-Task-24). The /api/sign/[token] route
  // still has cookie-based dedup for surfaces that hit it directly.
  // Pull request metadata via headers() since we don't have the Request
  // object inside a Server Component.
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0].trim() : (h.get("x-real-ip") ?? null);
  const ua = h.get("user-agent");

  try {
    await writeContractEvent(supabase, {
      contractId: contract.id,
      eventType: "link_viewed",
      signerId: signer.id,
      ipAddress: ip,
      userAgent: ua,
    });
  } catch {
    // Audit failures must not block the signer from seeing their contract.
  }
  if (!contract.first_viewed_at) {
    await supabase
      .from("contracts")
      .update({
        first_viewed_at: new Date().toISOString(),
        status: contract.status === "sent" ? "viewed" : contract.status,
      })
      .eq("id", contract.id);
  }
  await supabase
    .from("contracts")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", contract.id);

  // Branding from the view the helper already loaded.
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
        <SignedRedirectWrapper view={view} signToken={token} />
        <AuditFooter />
      </div>
    </div>
  );
}

// `BuildViewError` codes from build-public-signing-view; mapped here to
// human-readable labels used by ErrorShell.
type BuildViewErrorCode =
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

function errorInfoFor(code: BuildViewErrorCode): ErrorInfo {
  switch (code) {
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
