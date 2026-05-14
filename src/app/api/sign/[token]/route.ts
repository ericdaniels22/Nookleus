import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifySigningToken,
  InvalidSigningTokenError,
  generateSigningToken,
} from "@/lib/contracts/tokens";
import { writeContractEvent, getRequestIp, getRequestUserAgent } from "@/lib/contracts/audit";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { computeInitialNextReminderAt } from "@/lib/contracts/reminders";
import { finalizeSignedContract } from "@/lib/contracts/finalize";
import { buildPublicSigningViewByToken, type BuildViewError } from "@/lib/contracts/build-public-signing-view";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  ContractEmailSettings,
} from "@/lib/contracts/types";

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

const ERROR_HTTP_STATUS: Record<BuildViewError, number> = {
  invalid_token: 401,
  stale_token: 410,
  expired: 410,
  voided: 410,
  not_found: 404,
  signer_not_found: 404,
  template_not_found: 404,
};

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
  const supabase = createServiceClient();

  const result = await buildPublicSigningViewByToken(supabase, token);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: ERROR_HTTP_STATUS[result.error] ?? 500 },
    );
  }
  const { view, contract, signer } = result;

  // View-dedup audit: only fires once per browser session per contract.
  // The route handler is still reachable directly (HEAD/preflight, the
  // download flow) so the cookie gate continues to apply here.
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
      console.warn("[sign] finalize notifications had non-sent outcomes", {
        contract_id: contract.id,
        was_already_finalized: finalizeResult.wasAlreadyFinalized,
        summary,
      });
    }
  }

  if (!allSigned) {
    // Multi-signer handoff: more signers remain. Generate the next signer's
    // token, rotate contracts.link_token via activate_next_signer RPC, send
    // them the signing-request email, and schedule their first reminder.
    // Best-effort — the current signer's signature is already recorded; any
    // failure here is logged via audit and does not surface to the signer.
    try {
      const { data: settings } = await supabase
        .from("contract_email_settings")
        .select("*")
        .eq("organization_id", contract.organization_id)
        .limit(1)
        .maybeSingle<ContractEmailSettings>();
      if (!settings) throw new Error("contract_email_settings row missing");

      const remaining = (refreshedSigners ?? [])
        .filter((s) => !s.signed_at)
        .sort((a, b) => a.signer_order - b.signer_order);
      const next = remaining[0];
      if (!next) throw new Error("no_next_signer_found");

      const { data: nextRow } = await supabase
        .from("contract_signers")
        .select("*")
        .eq("id", next.id)
        .maybeSingle<ContractSigner>();
      if (!nextRow) throw new Error("next signer row missing");

      const expiryDays = Math.max(
        1,
        Math.min(30, settings.default_link_expiry_days),
      );
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
      const newToken = generateSigningToken({
        contractId: contract.id,
        signerId: nextRow.id,
        expiresAt,
      });

      const { error: actErr } = await supabase.rpc("activate_next_signer", {
        p_contract_id: contract.id,
        p_next_signer_id: nextRow.id,
        p_link_token: newToken,
        p_link_expires_at: expiresAt.toISOString(),
      });
      if (actErr) throw new Error(actErr.message);

      const { subject, html } = await resolveEmailTemplate(
        supabase,
        settings.signing_request_subject_template,
        settings.signing_request_body_template,
        contract.job_id,
        {
          signing_link: `${appUrl()}/sign/${newToken}`,
          document_title: contract.title,
        },
      );
      await sendContractEmail(supabase, settings, {
        to: nextRow.email,
        subject,
        html,
      });

      const firstReminder = computeInitialNextReminderAt(
        new Date(),
        settings.reminder_day_offsets,
      );
      if (firstReminder) {
        await supabase.rpc("schedule_first_reminder", {
          p_contract_id: contract.id,
          p_next_reminder_at: firstReminder.toISOString(),
        });
      }
    } catch (e) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "next_signer_activation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
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
}
