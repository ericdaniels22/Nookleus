"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import type { Contract, ContractSigner, ContractTemplate, PublicSigningView } from "@/lib/contracts/types";
import { resolveMergeValues } from "@/lib/contracts/resolve-merge-values";
import InPersonSigningWrapper from "./in-person-signing-wrapper";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  logo_url: string | null;
}

async function loadCompany(orgId: string): Promise<CompanyBrand> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", orgId)
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    address: m.get("address") || "",
    logo_url: m.get("logo_url") || null,
  };
}

// /contracts/[id]/sign-in-person — full-screen internal tablet view.
// Auth-required: Eric or a tech must be logged in; the iPad is theirs,
// they hand it to the customer for the signature + consent + submit.
export default async function SignInPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await authClient.auth.getUser();
  if (authErr || !user) {
    redirect(`/login?next=/contracts/${id}/sign-in-person`);
  }

  const supabase = createServiceClient();
  const [{ data: contract }, { data: signersRaw }] = await Promise.all([
    supabase.from("contracts").select("*").eq("id", id).maybeSingle<Contract>(),
    supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", id)
      .order("signer_order"),
  ]);

  if (!contract) {
    return (
      <ErrorShell title="Contract not found" subtitle="This signing session is no longer valid." />
    );
  }
  if (contract.status === "voided") {
    return (
      <ErrorShell
        title="This contract has been voided"
        subtitle="Return to the job to see history."
      />
    );
  }
  if (contract.status === "signed") {
    redirect(`/contracts/${id}/sign-in-person/complete`);
  }

  const signers = (signersRaw ?? []) as ContractSigner[];
  if (!signers.length) {
    return (
      <ErrorShell
        title="Contract has no signers"
        subtitle="Return to the job and recreate the contract."
      />
    );
  }
  const active = signers.find((s) => !s.signed_at);
  if (!active) {
    redirect(`/contracts/${id}/sign-in-person/complete`);
  }

  // Load template, company, and resolve merge values in parallel.
  const [{ data: templateRaw }, company, resolved] = await Promise.all([
    supabase
      .from("contract_templates")
      .select("*")
      .eq("id", contract.template_id)
      .maybeSingle<ContractTemplate>(),
    loadCompany(contract.organization_id),
    resolveMergeValues(supabase, contract.job_id, {
      signedAt: contract.signed_at ? new Date(contract.signed_at) : undefined,
    }),
  ]);

  if (!templateRaw) {
    return (
      <ErrorShell
        title="Template not found"
        subtitle="The contract template is missing. Contact support."
      />
    );
  }

  // Build a signed URL for the source PDF (valid 10 minutes — enough for signing).
  let pdfUrl: string | null = null;
  if (templateRaw.pdf_storage_path) {
    const { data: signed } = await supabase.storage
      .from("contract-pdfs")
      .createSignedUrl(templateRaw.pdf_storage_path, 600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  // Build the PublicSigningView shape the component expects.
  const view: PublicSigningView = {
    contract: {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      link_expires_at: contract.link_expires_at,
      signed_at: contract.signed_at,
      signed_pdf_path: contract.signed_pdf_path,
      legacy_html: templateRaw.pdf_storage_path ? null : (contract.filled_content_html ?? null),
    },
    template: {
      id: templateRaw.id,
      pdf_url: pdfUrl,
      pdf_pages: templateRaw.pdf_pages,
      overlay_fields: templateRaw.overlay_fields,
      signer_count: templateRaw.signer_count,
      signer_role_label: templateRaw.signer_role_label,
    },
    resolved_merge_values: resolved,
    signer: {
      id: active!.id,
      signer_order: active!.signer_order,
      name: active!.name,
      role_label: active!.role_label,
      signed_at: active!.signed_at,
    },
    other_signers: signers
      .filter((s) => s.id !== active!.id)
      .map((s) => ({ id: s.id, signer_order: s.signer_order, signed_at: s.signed_at })),
    company: {
      name: company.name,
      phone: company.phone,
      email: company.email,
      address: company.address,
      logo_url: company.logo_url,
    },
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link
          href={`/jobs/${contract.job_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to job
        </Link>
        <HeaderBlock company={company} title={contract.title} />
        {/* Client wrapper handles onSigned → router.push */}
        <InPersonSigningWrapper view={view} contractId={id} />
      </div>
    </div>
  );
}

function HeaderBlock({ company, title }: { company: CompanyBrand; title: string }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 pb-4 border-b border-border">
      <div className="flex items-center gap-3 min-w-0">
        {company.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo_url}
            alt={company.name || "Company logo"}
            className="w-10 h-10 rounded-md object-contain bg-white/5"
          />
        ) : null}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground truncate">
            {company.name || "Contract"}
          </div>
          <div className="text-base font-medium text-muted-foreground truncate">{title}</div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-[rgba(15,110,86,0.15)] text-[#5DCAA5] border border-[rgba(15,110,86,0.35)] whitespace-nowrap">
        Hand to Customer
      </span>
    </div>
  );
}

function ErrorShell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2 text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
