import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { finalizeSignedContract } from "@/lib/contracts/finalize";
import type { Contract, ContractSigner, ContractTemplate } from "@/lib/contracts/types";

// POST /api/contracts/in-person
// Records the in-person signer's customer_inputs + signature, then mirrors
// the public-link stamping pipeline. Authenticated via Supabase session
// (admin-on-iPad flow); the request body provides contract_id + signer_id
// so a single user account can drive multiple signers in turn.
//
// Requires `edit_jobs` (#106) — contracts are gated on the job permissions.
// The Service client drives the stamping pipeline.
export const POST = withRequestContext(
  { permission: "edit_jobs", serviceClient: true },
  async (request, ctx) => {
    const supabase = ctx.serviceClient!;

    const body = (await request.json().catch(() => ({}))) as {
      contract_id?: string;
      signer_id?: string;
      customer_inputs?: Record<string, string | boolean>;
      signature_data_url?: string;
    };
    if (!body.contract_id || !body.signer_id) {
      return NextResponse.json({ error: "contract_id and signer_id are required" }, { status: 400 });
    }
    const customerInputs = body.customer_inputs ?? {};
    const signatureDataUrl = body.signature_data_url;
    if (!signatureDataUrl) {
      return NextResponse.json({ error: "missing_signature" }, { status: 400 });
    }

    const { data: contract } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", body.contract_id)
      .maybeSingle<Contract>();
    if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (contract.status === "voided" || contract.status === "expired" || contract.status === "signed") {
      return NextResponse.json({ error: "not_signable", status: contract.status }, { status: 409 });
    }

    const { data: signer } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("id", body.signer_id)
      .eq("contract_id", contract.id)
      .maybeSingle<ContractSigner>();
    if (!signer) return NextResponse.json({ error: "signer_not_found" }, { status: 404 });
    if (signer.signed_at) {
      return NextResponse.json({ error: "already_signed" }, { status: 409 });
    }

    const { data: template } = await supabase
      .from("contract_templates")
      .select("*")
      .eq("id", contract.template_id)
      .maybeSingle<ContractTemplate>();
    if (!template) return NextResponse.json({ error: "template_not_found" }, { status: 404 });

    const missing = template.overlay_fields
      .filter((f) => {
        if (f.type === "checkbox" && f.autoFillBinding) return false;
        if (f.type === "input" && f.required && !customerInputs[f.inputKey ?? ""]) return true;
        if (f.type === "checkbox" && f.required && customerInputs[f.inputKey ?? ""] !== true) return true;
        return false;
      })
      .map((f) => f.inputKey ?? "");
    if (missing.length) {
      return NextResponse.json({ error: "missing_required", fields: missing }, { status: 400 });
    }

    const sigPath = `${contract.organization_id}/contracts/${contract.id}/signer-${signer.id}.png`;
    const sigBytes = Uint8Array.from(
      atob(signatureDataUrl.split(",")[1] ?? ""),
      (c) => c.charCodeAt(0),
    );
    const { error: sigUploadErr } = await supabase.storage
      .from("contract-pdfs")
      .upload(sigPath, sigBytes, { contentType: "image/png", upsert: true });
    if (sigUploadErr) {
      return NextResponse.json(
        { error: "signature_upload_failed", detail: sigUploadErr.message },
        { status: 500 },
      );
    }

    const signedAt = new Date();
    await supabase
      .from("contract_signers")
      .update({
        signature_image_path: sigPath,
        signed_at: signedAt.toISOString(),
        ip_address: getRequestIp(request),
        user_agent: getRequestUserAgent(request),
      })
      .eq("id", signer.id);

    const mergedInputs = { ...(contract.customer_inputs ?? {}), ...customerInputs };
    await supabase.from("contracts").update({ customer_inputs: mergedInputs }).eq("id", contract.id);

    const { data: refreshedSigners } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract.id)
      .order("signer_order");
    const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);

    if (allSigned && template.pdf_storage_path) {
      const finalizeResult = await finalizeSignedContract({
        supabase,
        contract,
        template,
        signers: (refreshedSigners ?? []) as ContractSigner[],
        customerInputs: mergedInputs,
        signedAt,
      });
      const { summary } = finalizeResult.notifications;
      if (summary.failed > 0 || summary.skipped > 0) {
        console.warn("[in-person] finalize notifications had non-sent outcomes", {
          contract_id: contract.id,
          was_already_finalized: finalizeResult.wasAlreadyFinalized,
          summary,
        });
      }
    }

    try {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "signed",
        signerId: signer.id,
        ipAddress: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
      });
    } catch {
      // Audit failures must not block a successful sign.
    }

    return NextResponse.json({ ok: true, all_signed: allSigned });
  },
);
