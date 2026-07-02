import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import type { ContractSigner } from "@/lib/contracts/types";
import { buildPublicSigningViewForContract } from "@/lib/contracts/build-public-signing-view";
import InPersonSigningWrapper from "./in-person-signing-wrapper";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  logo_url: string | null;
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

  // Quick load of contract + signers to determine status and pick the
  // active (next unsigned) signer. Detailed view-shape construction
  // happens via buildPublicSigningViewForContract once we know the active.
  const [{ data: contract }, { data: signersRaw }] = await Promise.all([
    supabase
      .from("contracts")
      .select("id, status, job_id")
      .eq("id", id)
      .maybeSingle<{ id: string; status: string; job_id: string }>(),
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
    return redirect(`/contracts/${id}/sign-in-person/complete`);
  }

  const result = await buildPublicSigningViewForContract(supabase, id, active.id);
  if (!result.ok) {
    if (result.error === "voided") {
      return (
        <ErrorShell
          title="This contract has been voided"
          subtitle="Return to the job to see history."
        />
      );
    }
    if (result.error === "template_not_found") {
      return (
        <ErrorShell
          title="Template not found"
          subtitle="The contract template is missing. Contact support."
        />
      );
    }
    return (
      <ErrorShell title="Contract not available" subtitle="This signing session is no longer valid." />
    );
  }

  const { view } = result;
  const company: CompanyBrand = {
    name: view.company.name,
    phone: view.company.phone,
    email: view.company.email,
    address: view.company.address,
    logo_url: view.company.logo_url,
  };

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <Link
          href={`/jobs/${result.contract.job_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          Back to job
        </Link>
        <HeaderBlock company={company} title={view.contract.title} />
        {/* Client wrapper handles onSigned → push-to-complete or refresh */}
        <InPersonSigningWrapper view={view} />
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
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-accent-tint text-accent-text border border-primary/25 whitespace-nowrap">
        Hand to Customer
      </span>
    </div>
  );
}

function ErrorShell({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2 text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
