import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceJobOnContractSigned } from "@/lib/job-status-transitions";
import { writeContractEvent } from "./audit";
import { resolveMergeValues } from "./resolve-merge-values";
import { resolveEmailTemplate } from "./email-merge-fields";
import { renderBrandedContractEmail } from "./branded-email";
import { sendContractEmail, resolveInternalRecipient } from "./email";
import { stampPdf } from "./stamp-pdf";
import type {
  Contract,
  ContractSigner,
  ContractTemplate,
  ContractEmailSettings,
} from "./types";

export interface FinalizeArgs {
  supabase: SupabaseClient;
  contract: Contract;
  template: ContractTemplate;
  signers: ContractSigner[];           // ordered by signer_order, all signed
  customerInputs: Record<string, string | boolean>;
  signedAt: Date;
}

export type SkippedReason =
  | "settings_missing"
  | "no_internal_recipient"
  | "no_signer_email";

export type NotificationResult =
  | { status: "sent"; provider: string; messageId: string }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: SkippedReason };

export interface NotificationOutcome {
  recipient: "customer" | "internal";
  signerId?: string;
  to: string | null;
  result: NotificationResult;
}

export interface FinalizeNotifications {
  summary: { sent: number; failed: number; skipped: number };
  outcomes: NotificationOutcome[];
}

export interface FinalizeResult {
  signedPdfPath: string;
  wasAlreadyFinalized: boolean;
  notifications: FinalizeNotifications;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_");
}

function summarize(
  outcomes: NotificationOutcome[],
): FinalizeNotifications["summary"] {
  return outcomes.reduce(
    (acc, o) => {
      if (o.result.status === "sent") acc.sent += 1;
      else if (o.result.status === "failed") acc.failed += 1;
      else acc.skipped += 1;
      return acc;
    },
    { sent: 0, failed: 0, skipped: 0 },
  );
}

function emptyNotifications(): FinalizeNotifications {
  return { summary: { sent: 0, failed: 0, skipped: 0 }, outcomes: [] };
}

// One audit row per intended recipient with a unified metadata shape:
//   sent:    { kind, signer_id?, provider, message_id }
//   failed:  { kind, signer_id?, error }
//   skipped: { kind, signer_id?, skipped_reason }
// On audit-write failure: console.error so Vercel logs preserve the
// intended outcome. A durable secondary fallback is a future hardening
// pass for when real customers are signing.
async function recordOutcome(
  supabase: SupabaseClient,
  contractId: string,
  outcome: NotificationOutcome,
): Promise<void> {
  const kind =
    outcome.recipient === "customer"
      ? "customer_confirmation"
      : "internal_confirmation";
  const baseMeta: Record<string, unknown> = { kind };
  if (outcome.signerId) baseMeta.signer_id = outcome.signerId;

  let metadata: Record<string, unknown>;
  if (outcome.result.status === "sent") {
    metadata = {
      ...baseMeta,
      provider: outcome.result.provider,
      message_id: outcome.result.messageId,
    };
  } else if (outcome.result.status === "failed") {
    metadata = { ...baseMeta, error: outcome.result.error };
  } else {
    metadata = { ...baseMeta, skipped_reason: outcome.result.reason };
  }

  try {
    await writeContractEvent(supabase, {
      contractId,
      eventType: "email_delivered",
      signerId: outcome.signerId ?? null,
      metadata,
    });
  } catch (auditError) {
    console.error("[finalize] audit row write failed", {
      contractId,
      kind,
      signerId: outcome.signerId,
      originalOutcome: outcome.result,
      auditError:
        auditError instanceof Error ? auditError.message : String(auditError),
    });
  }
}

interface SealResult {
  signedPdfPath: string;
  stampedPdfBytes: Uint8Array;
}

// Transactional half: download signatures + source PDF, stamp, upload,
// flip status. Throws on any failure — emails never dispatch on a
// failed seal.
async function sealContract(args: FinalizeArgs): Promise<SealResult> {
  const { supabase, contract, template, signers, customerInputs, signedAt } = args;

  if (!template.pdf_storage_path) {
    throw new Error("finalizeSignedContract: template.pdf_storage_path is null");
  }

  const dataUrlsBySignerId: Record<string, string> = {};
  const orderById: Record<string, 1 | 2> = {};
  for (const s of signers) {
    if (!s.signature_image_path) continue;
    const { data: blob, error } = await supabase.storage
      .from("contract-pdfs")
      .download(s.signature_image_path);
    if (error || !blob) {
      throw new Error(
        `finalizeSignedContract: failed to download signature for signer ${s.id}: ${error?.message ?? "missing"}`,
      );
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    const b64 = Buffer.from(buf).toString("base64");
    dataUrlsBySignerId[s.id] = `data:image/png;base64,${b64}`;
    orderById[s.id] = s.signer_order;
  }

  const { data: srcBlob, error: srcErr } = await supabase.storage
    .from("contract-pdfs")
    .download(template.pdf_storage_path);
  if (srcErr || !srcBlob) {
    throw new Error(
      `finalizeSignedContract: failed to download source PDF: ${srcErr?.message ?? "missing"}`,
    );
  }
  const srcBytes = new Uint8Array(await srcBlob.arrayBuffer());

  const resolved = await resolveMergeValues(supabase, contract.job_id, { signedAt });
  const stamped = await stampPdf({
    sourcePdfBytes: srcBytes,
    pdfPages: template.pdf_pages ?? [],
    overlayFields: template.overlay_fields,
    resolvedMergeValues: resolved,
    customerInputs,
    signatureDataUrls: dataUrlsBySignerId,
    signerOrderById: orderById,
    signedAt,
  });

  const stampedPath = `${contract.organization_id}/contracts/${contract.id}-signed.pdf`;
  const { error: stampedUploadErr } = await supabase.storage
    .from("contract-pdfs")
    .upload(stampedPath, stamped, { contentType: "application/pdf", upsert: true });
  if (stampedUploadErr) {
    throw new Error(
      `finalizeSignedContract: stamped PDF upload failed: ${stampedUploadErr.message}`,
    );
  }

  const { error: statusFlipErr } = await supabase
    .from("contracts")
    .update({
      status: "signed",
      signed_pdf_path: stampedPath,
      signed_at: signedAt.toISOString(),
    })
    .eq("id", contract.id);
  if (statusFlipErr) {
    throw new Error(
      `finalizeSignedContract: status flip failed: ${statusFlipErr.message}`,
    );
  }

  return { signedPdfPath: stampedPath, stampedPdfBytes: stamped };
}

// Best-effort half: load settings, dispatch per-signer customer emails +
// one internal email, write one audit row per intended recipient with a
// unified outcome shape. Never throws out — failures land in the
// outcomes list (and audit rows) instead.
async function dispatchNotifications(
  supabase: SupabaseClient,
  contract: Contract,
  signers: ContractSigner[],
  stampedPdfBytes: Uint8Array,
): Promise<FinalizeNotifications> {
  const outcomes: NotificationOutcome[] = [];

  let settings: ContractEmailSettings | null = null;
  try {
    const { data } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", contract.organization_id)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    settings = data ?? null;
  } catch {
    settings = null;
  }

  if (!settings) {
    for (const s of signers) {
      outcomes.push({
        recipient: "customer",
        signerId: s.id,
        to: null,
        result: { status: "skipped", reason: "settings_missing" },
      });
    }
    outcomes.push({
      recipient: "internal",
      to: null,
      result: { status: "skipped", reason: "settings_missing" },
    });
    for (const o of outcomes) await recordOutcome(supabase, contract.id, o);
    return { summary: summarize(outcomes), outcomes };
  }

  const pdfAttachment = {
    filename: `${sanitizeForFilename(contract.title)}.pdf`,
    content: Buffer.from(stampedPdfBytes),
    contentType: "application/pdf",
  };

  for (const s of signers) {
    if (!s.email) {
      outcomes.push({
        recipient: "customer",
        signerId: s.id,
        to: null,
        result: { status: "skipped", reason: "no_signer_email" },
      });
      continue;
    }
    try {
      const { subject, html: message } = await resolveEmailTemplate(
        supabase,
        settings.signed_confirmation_subject_template,
        settings.signed_confirmation_body_template,
        contract.job_id,
        { signing_link: "", document_title: contract.title },
      );
      // Post-sign confirmation wears the branded card as a done-state receipt:
      // a null action url draws no button, and the signed PDF stays attached
      // (#693, ADR 0017 §4). The frame is assembled AROUND the sanitized
      // message inside renderBrandedContractEmail.
      const html = await renderBrandedContractEmail(supabase, settings, {
        kind: "signed_confirmation",
        organizationId: contract.organization_id,
        message,
        actionUrl: null,
        documentTitle: contract.title,
      });
      const result = await sendContractEmail(supabase, settings, {
        to: s.email,
        subject,
        html,
        attachments: [pdfAttachment],
      });
      outcomes.push({
        recipient: "customer",
        signerId: s.id,
        to: s.email,
        result: {
          status: "sent",
          provider: result.provider,
          messageId: result.messageId,
        },
      });
    } catch (e) {
      outcomes.push({
        recipient: "customer",
        signerId: s.id,
        to: s.email,
        result: {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  try {
    let internalAddress: string | null = null;
    if (settings.provider === "email_account" && settings.email_account_id) {
      const { data: acct } = await supabase
        .from("email_accounts")
        .select("email_address")
        .eq("id", settings.email_account_id)
        .maybeSingle<{ email_address: string }>();
      internalAddress = acct?.email_address ?? null;
    }
    const internalTo = resolveInternalRecipient(settings, internalAddress);
    if (!internalTo) {
      outcomes.push({
        recipient: "internal",
        to: null,
        result: { status: "skipped", reason: "no_internal_recipient" },
      });
    } else {
      const platformUrl = `${appUrl()}/jobs/${contract.job_id}`;
      const { subject, html: message } = await resolveEmailTemplate(
        supabase,
        settings.signed_confirmation_internal_subject_template,
        settings.signed_confirmation_internal_body_template,
        contract.job_id,
        {
          signing_link: "",
          document_title: contract.title,
          contract_platform_url: platformUrl,
        },
      );
      // Internal staff notification wears the branded card with the app-fixed
      // "View contract" button pointing at the internal platform view; the app
      // injects that url into the button rather than the body (#693, ADR 0017
      // §4).
      const html = await renderBrandedContractEmail(supabase, settings, {
        kind: "internal_notification",
        organizationId: contract.organization_id,
        message,
        actionUrl: platformUrl,
        documentTitle: contract.title,
      });
      const result = await sendContractEmail(supabase, settings, {
        to: internalTo,
        subject,
        html,
        attachments: [pdfAttachment],
      });
      outcomes.push({
        recipient: "internal",
        to: internalTo,
        result: {
          status: "sent",
          provider: result.provider,
          messageId: result.messageId,
        },
      });
    }
  } catch (e) {
    outcomes.push({
      recipient: "internal",
      to: null,
      result: {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }

  for (const o of outcomes) await recordOutcome(supabase, contract.id, o);
  return { summary: summarize(outcomes), outcomes };
}

// Owns the post-final-signer pipeline: seal the contract (stamp +
// upload + flip status) then dispatch confirmation emails. Refuses to
// run twice — if the contract is already signed, returns immediately
// with `wasAlreadyFinalized: true` and the existing PDF path. The seal
// is transactional; if it fails, emails are never dispatched. Emails
// are best-effort; failures are reported via the returned notifications
// block and a contract_events row per intended recipient.
export async function finalizeSignedContract(
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const { supabase, contract } = args;

  const { data: current } = await supabase
    .from("contracts")
    .select("status, signed_pdf_path")
    .eq("id", contract.id)
    .maybeSingle<{ status: Contract["status"]; signed_pdf_path: string | null }>();
  if (current?.status === "signed" && current.signed_pdf_path) {
    return {
      signedPdfPath: current.signed_pdf_path,
      wasAlreadyFinalized: true,
      notifications: emptyNotifications(),
    };
  }

  const sealed = await sealContract(args);

  // The one automatic Job-status move (#721): a signed contract advances a
  // Lead or Lost Job to Active. Best-effort and idempotent — placed after the
  // seal so a re-finalize early-returns above and never re-advances; a status
  // hiccup must never break a legally-completed signing.
  await advanceJobOnContractSigned(supabase, contract.job_id);

  const notifications = await dispatchNotifications(
    supabase,
    contract,
    args.signers,
    sealed.stampedPdfBytes,
  );

  return {
    signedPdfPath: sealed.signedPdfPath,
    wasAlreadyFinalized: false,
    notifications,
  };
}
