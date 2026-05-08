import type { SupabaseClient } from "@supabase/supabase-js";
import { verifySigningToken, InvalidSigningTokenError } from "./tokens";
import { resolveMergeValues } from "./resolve-merge-values";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  PublicSigningView,
} from "./types";

// Error codes that mirror the HTTP error envelope returned by
// /api/sign/[token] GET. The route handler maps these to status codes;
// the page-side caller maps these to ErrorShell copy.
export type BuildViewError =
  | "invalid_token"
  | "stale_token"
  | "expired"
  | "voided"
  | "not_found"
  | "signer_not_found"
  | "template_not_found";

export type BuildViewResult =
  | {
      ok: true;
      view: PublicSigningView;
      contract: Contract & { link_token: string | null };
      signer: ContractSigner;
    }
  | { ok: false; error: BuildViewError };

interface LoadedBundle {
  contract: Contract & { link_token: string | null };
  signer: ContractSigner;
  template: ContractTemplate;
  allSigners: { id: string; signer_order: 1 | 2; signed_at: string | null }[];
  companyMap: Map<string, string | null>;
}

async function loadCompanyMap(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Map<string, string | null>> {
  const { data: rows } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  return new Map<string, string | null>(
    (rows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );
}

async function buildViewFromBundle(
  supabase: SupabaseClient,
  bundle: LoadedBundle,
): Promise<PublicSigningView> {
  const { contract, signer, template, allSigners, companyMap } = bundle;

  let pdfUrl: string | null = null;
  if (template.pdf_storage_path) {
    const { data: signed } = await supabase.storage
      .from("contract-pdfs")
      .createSignedUrl(template.pdf_storage_path, 600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  const resolved = await resolveMergeValues(supabase, contract.job_id, {
    signedAt: contract.signed_at ? new Date(contract.signed_at) : undefined,
  });

  return {
    contract: {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      link_expires_at: contract.link_expires_at,
      signed_at: contract.signed_at,
      signed_pdf_path: contract.signed_pdf_path,
      legacy_html: template.pdf_storage_path
        ? null
        : (contract.filled_content_html ?? null),
    },
    template: {
      id: template.id,
      pdf_url: pdfUrl,
      pdf_pages: template.pdf_pages,
      overlay_fields: template.overlay_fields,
      signer_count: template.signer_count,
      signer_role_label: template.signer_role_label,
    },
    resolved_merge_values: resolved,
    signer: {
      id: signer.id,
      signer_order: signer.signer_order,
      name: signer.name,
      role_label: signer.role_label,
      signed_at: signer.signed_at,
    },
    other_signers: allSigners
      .filter((s) => s.id !== signer.id)
      .map((s) => ({ id: s.id, signer_order: s.signer_order, signed_at: s.signed_at })),
    company: {
      name: companyMap.get("company_name") || "",
      phone: companyMap.get("phone") || "",
      email: companyMap.get("email") || "",
      address: companyMap.get("address") || "",
      logo_url: companyMap.get("logo_url") || null,
    },
  };
}

/**
 * Loads a contract + signer + template + company branding for a JWT
 * signing token, returning a fully constructed PublicSigningView. Used
 * by both the API route GET and (since this fix block) the public page
 * SSR — the previous self-fetch approach silently dropped Set-Cookie
 * and double-wrote audit events.
 *
 * Note: this helper does NOT mark expired / write audit events / set
 * the view-dedup cookie. Callers handle those side effects so we can
 * keep the data-loading path pure and easily unit-testable.
 */
export async function buildPublicSigningViewByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<BuildViewResult> {
  let payload: { contract_id: string; signer_id: string };
  try {
    payload = verifySigningToken(token);
  } catch (e) {
    if (e instanceof InvalidSigningTokenError) {
      return { ok: false, error: "invalid_token" };
    }
    throw e;
  }

  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", payload.contract_id)
    .maybeSingle<Contract & { link_token: string | null }>();
  if (error) throw new Error(error.message);
  if (!contract) return { ok: false, error: "not_found" };
  if (contract.link_token !== token) return { ok: false, error: "stale_token" };

  if (
    contract.link_expires_at &&
    (contract.status === "sent" || contract.status === "viewed") &&
    new Date(contract.link_expires_at).getTime() < Date.now()
  ) {
    await supabase.rpc("mark_contract_expired", { p_contract_id: contract.id });
    return { ok: false, error: "expired" };
  }

  if (contract.status === "voided") return { ok: false, error: "voided" };

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", payload.signer_id)
    .maybeSingle<ContractSigner>();
  if (!signer) return { ok: false, error: "signer_not_found" };

  const { data: template } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", contract.template_id)
    .maybeSingle<ContractTemplate>();
  if (!template) return { ok: false, error: "template_not_found" };

  const { data: allSigners } = await supabase
    .from("contract_signers")
    .select("id, signer_order, signed_at")
    .eq("contract_id", contract.id);

  const companyMap = await loadCompanyMap(supabase, contract.organization_id);

  const view = await buildViewFromBundle(supabase, {
    contract,
    signer,
    template,
    allSigners: (allSigners ?? []) as {
      id: string;
      signer_order: 1 | 2;
      signed_at: string | null;
    }[],
    companyMap,
  });
  return { ok: true, view, contract, signer };
}

/**
 * In-person counterpart to buildPublicSigningViewByToken. The iPad flow
 * is authenticated via Supabase session, so there's no JWT — caller
 * already knows the contract ID and which signer they want to load.
 */
export async function buildPublicSigningViewForContract(
  supabase: SupabaseClient,
  contractId: string,
  signerId: string,
): Promise<BuildViewResult> {
  const { data: contract } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", contractId)
    .maybeSingle<Contract & { link_token: string | null }>();
  if (!contract) return { ok: false, error: "not_found" };
  if (contract.status === "voided") return { ok: false, error: "voided" };

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", signerId)
    .eq("contract_id", contract.id)
    .maybeSingle<ContractSigner>();
  if (!signer) return { ok: false, error: "signer_not_found" };

  const { data: template } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", contract.template_id)
    .maybeSingle<ContractTemplate>();
  if (!template) return { ok: false, error: "template_not_found" };

  const { data: allSigners } = await supabase
    .from("contract_signers")
    .select("id, signer_order, signed_at")
    .eq("contract_id", contract.id);

  const companyMap = await loadCompanyMap(supabase, contract.organization_id);

  const view = await buildViewFromBundle(supabase, {
    contract,
    signer,
    template,
    allSigners: (allSigners ?? []) as {
      id: string;
      signer_order: 1 | 2;
      signed_at: string | null;
    }[],
    companyMap,
  });
  return { ok: true, view, contract, signer };
}
