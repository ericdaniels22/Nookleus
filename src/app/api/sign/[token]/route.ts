import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import { verifySigningToken, InvalidSigningTokenError } from "@/lib/contracts/tokens";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { resolveMergeValues } from "@/lib/contracts/resolve-merge-values";
import { stampPdf } from "@/lib/contracts/stamp-pdf";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  PublicSigningView,
} from "@/lib/contracts/types";

// GET /api/sign/[token]
// Public endpoint for the signing page. Validates the JWT, loads the
// contract + template + signers via service role (never touches RLS),
// resolves merge values from the job context, returns a signed URL for
// the source PDF, logs the link_viewed event once per browser session.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let payload: { contract_id: string; signer_id: string };
  try {
    payload = verifySigningToken(token);
  } catch (e) {
    if (e instanceof InvalidSigningTokenError) {
      return NextResponse.json({ error: "invalid_token", message: e.message }, { status: 401 });
    }
    throw e;
  }

  const supabase = createServiceClient();
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", payload.contract_id)
    .maybeSingle<Contract & { link_token: string | null; filled_content_html: string }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.link_token !== token) {
    return NextResponse.json({ error: "stale_token" }, { status: 410 });
  }

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", payload.signer_id)
    .maybeSingle<ContractSigner>();
  if (!signer) {
    return NextResponse.json({ error: "signer_not_found" }, { status: 404 });
  }

  if (
    contract.link_expires_at &&
    (contract.status === "sent" || contract.status === "viewed") &&
    new Date(contract.link_expires_at).getTime() < Date.now()
  ) {
    await supabase.rpc("mark_contract_expired", { p_contract_id: contract.id });
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  if (contract.status === "voided") {
    return NextResponse.json({ error: "voided" }, { status: 410 });
  }

  const { data: template } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", contract.template_id)
    .maybeSingle<ContractTemplate>();
  if (!template) {
    return NextResponse.json({ error: "template_not_found" }, { status: 404 });
  }

  const { data: allSigners } = await supabase
    .from("contract_signers")
    .select("id, signer_order, signed_at")
    .eq("contract_id", contract.id);

  const { data: companyRows } = await supabase
    .from("company_settings")
    .select("key, value")
    .eq("organization_id", contract.organization_id)
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const map = new Map<string, string | null>(
    (companyRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  );

  const cookieName = `sv_${contract.id.slice(0, 8)}`;
  const cookieStore = await cookies();
  const hasViewedCookie = cookieStore.get(cookieName);

  if (!hasViewedCookie) {
    try {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "link_viewed",
        signerId: signer.id,
        ipAddress: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
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
  }
  await supabase
    .from("contracts")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", contract.id);

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

  const view: PublicSigningView = {
    contract: {
      id: contract.id,
      title: contract.title,
      status: contract.status,
      link_expires_at: contract.link_expires_at,
      signed_at: contract.signed_at,
      signed_pdf_path: contract.signed_pdf_path,
      legacy_html: template.pdf_storage_path ? null : (contract.filled_content_html ?? null),
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
    other_signers: (allSigners ?? [])
      .filter((s) => s.id !== signer.id)
      .map((s) => ({ id: s.id, signer_order: s.signer_order, signed_at: s.signed_at })),
    company: {
      name: map.get("company_name") || "",
      phone: map.get("phone") || "",
      email: map.get("email") || "",
      address: map.get("address") || "",
      logo_url: map.get("logo_url") || null,
    },
  };

  const res = NextResponse.json(view);
  if (!hasViewedCookie && contract.link_expires_at) {
    const maxAge = Math.max(
      60,
      Math.floor((new Date(contract.link_expires_at).getTime() - Date.now()) / 1000),
    );
    res.cookies.set(cookieName, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });
  }
  return res;
}

// POST /api/sign/[token]
// Records the signer's customer_inputs + signature. If all signers have
// signed, stamps the final PDF (pdf-lib), uploads it to contract-pdfs,
// and flips the contract status to "signed". Otherwise leaves the status
// at "viewed" until the second signer submits.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let payload: { contract_id: string; signer_id: string };
  try {
    payload = verifySigningToken(token);
  } catch (e) {
    if (e instanceof InvalidSigningTokenError) {
      return NextResponse.json({ error: "invalid_token", message: e.message }, { status: 401 });
    }
    throw e;
  }

  const supabase = createServiceClient();

  const { data: contract } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", payload.contract_id)
    .maybeSingle<Contract & { link_token: string | null }>();
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (contract.link_token !== token) {
    return NextResponse.json({ error: "stale_token" }, { status: 410 });
  }
  if (contract.status === "voided" || contract.status === "expired" || contract.status === "signed") {
    return NextResponse.json({ error: "not_signable", status: contract.status }, { status: 409 });
  }

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("*")
    .eq("id", payload.signer_id)
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

  const body = (await request.json().catch(() => ({}))) as {
    customer_inputs?: Record<string, string | boolean>;
    signature_data_url?: string;
  };
  const customerInputs = body.customer_inputs ?? {};
  const signatureDataUrl = body.signature_data_url;
  if (!signatureDataUrl) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  const missing = template.overlay_fields
    .filter((f) => {
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
    return NextResponse.json({ error: "signature_upload_failed", detail: sigUploadErr.message }, { status: 500 });
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
    .select("id, signer_order, signed_at, signature_image_path")
    .eq("contract_id", contract.id);
  const allSigned = (refreshedSigners ?? []).every((s) => s.signed_at);

  if (allSigned && template.pdf_storage_path) {
    const dataUrlsBySignerId: Record<string, string> = {};
    const orderById: Record<string, 1 | 2> = {};
    for (const s of refreshedSigners ?? []) {
      if (!s.signature_image_path) continue;
      const { data: blob } = await supabase.storage
        .from("contract-pdfs")
        .download(s.signature_image_path);
      if (!blob) continue;
      const buf = new Uint8Array(await blob.arrayBuffer());
      const b64 = Buffer.from(buf).toString("base64");
      dataUrlsBySignerId[s.id] = `data:image/png;base64,${b64}`;
      orderById[s.id] = s.signer_order;
    }

    const { data: srcBlob } = await supabase.storage
      .from("contract-pdfs")
      .download(template.pdf_storage_path);
    if (!srcBlob) {
      return NextResponse.json({ error: "source_pdf_missing" }, { status: 500 });
    }
    const srcBytes = new Uint8Array(await srcBlob.arrayBuffer());

    const resolved = await resolveMergeValues(supabase, contract.job_id, { signedAt });
    const stamped = await stampPdf({
      sourcePdfBytes: srcBytes,
      pdfPages: template.pdf_pages ?? [],
      overlayFields: template.overlay_fields,
      resolvedMergeValues: resolved,
      customerInputs: mergedInputs,
      signatureDataUrls: dataUrlsBySignerId,
      signerOrderById: orderById,
      signedAt,
    });

    const stampedPath = `${contract.organization_id}/contracts/${contract.id}-signed.pdf`;
    const { error: stampedUploadErr } = await supabase.storage
      .from("contract-pdfs")
      .upload(stampedPath, stamped, { contentType: "application/pdf", upsert: true });
    if (stampedUploadErr) {
      return NextResponse.json({ error: "stamped_upload_failed", detail: stampedUploadErr.message }, { status: 500 });
    }

    await supabase
      .from("contracts")
      .update({
        status: "signed",
        signed_pdf_path: stampedPath,
        signed_at: signedAt.toISOString(),
      })
      .eq("id", contract.id);
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
}
