import type { SupabaseClient } from "@supabase/supabase-js";
import { writeContractEvent } from "./audit";
import { resolveMergeValues } from "./resolve-merge-values";
import { resolveEmailTemplate } from "./email-merge-fields";
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

export interface FinalizeResult {
  signedPdfPath: string;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "_");
}

// Owns the post-final-signer pipeline:
//   1. download signature PNGs + source template PDF
//   2. resolve merge values + stamp the PDF
//   3. upload stamped PDF + flip contracts.status to 'signed'
//   4. dispatch one customer confirmation email per signer (best-effort)
//   5. dispatch one internal confirmation email (best-effort)
//   6. write success/failure audit rows for every email send
//
// The signing operation is "done" once the status flip in step 3 lands.
// Steps 4–6 are best-effort: failures write an `email_delivered` audit
// row with `error: <message>` and do not throw out of finalize.
export async function finalizeSignedContract(
  args: FinalizeArgs,
): Promise<FinalizeResult> {
  const { supabase, contract, template, signers, customerInputs, signedAt } = args;

  // --- Stamp pipeline ---------------------------------------------------
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

  await supabase
    .from("contracts")
    .update({
      status: "signed",
      signed_pdf_path: stampedPath,
      signed_at: signedAt.toISOString(),
    })
    .eq("id", contract.id);

  // --- Email dispatch (best-effort) ------------------------------------
  // Wrap everything below in a single try; any uncaught throw lands as
  // one audit row noting the failure. Per-email try/catch below isolates
  // each send so one bad address does not block the others.
  try {
    const { data: settings } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", contract.organization_id)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();

    if (!settings) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "customer_confirmation",
          error: "contract_email_settings row missing",
        },
      }).catch(() => undefined);
      return { signedPdfPath: stampedPath };
    }

    const pdfAttachment = {
      filename: `${sanitizeForFilename(contract.title)}.pdf`,
      content: Buffer.from(stamped),
      contentType: "application/pdf",
    };

    // --- Customer confirmation, one per signer -------------------------
    for (const s of signers) {
      try {
        const { subject, html } = await resolveEmailTemplate(
          supabase,
          settings.signed_confirmation_subject_template,
          settings.signed_confirmation_body_template,
          contract.job_id,
          { signing_link: "", document_title: contract.title },
        );
        const result = await sendContractEmail(supabase, settings, {
          to: s.email,
          subject,
          html,
          attachments: [pdfAttachment],
        });
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          signerId: s.id,
          metadata: {
            kind: "customer_confirmation",
            signer_id: s.id,
            provider: result.provider,
            message_id: result.messageId,
          },
        });
      } catch (e) {
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          signerId: s.id,
          metadata: {
            kind: "customer_confirmation",
            signer_id: s.id,
            error: e instanceof Error ? e.message : String(e),
          },
        }).catch(() => undefined);
      }
    }

    // --- Internal confirmation -----------------------------------------
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
      if (internalTo) {
        const { subject, html } = await resolveEmailTemplate(
          supabase,
          settings.signed_confirmation_internal_subject_template,
          settings.signed_confirmation_internal_body_template,
          contract.job_id,
          {
            signing_link: "",
            document_title: contract.title,
            contract_platform_url: `${appUrl()}/jobs/${contract.job_id}`,
          },
        );
        const result = await sendContractEmail(supabase, settings, {
          to: internalTo,
          subject,
          html,
          attachments: [pdfAttachment],
        });
        await writeContractEvent(supabase, {
          contractId: contract.id,
          eventType: "email_delivered",
          metadata: {
            kind: "internal_confirmation",
            provider: result.provider,
            message_id: result.messageId,
          },
        });
      }
    } catch (e) {
      await writeContractEvent(supabase, {
        contractId: contract.id,
        eventType: "email_delivered",
        metadata: {
          kind: "internal_confirmation",
          error: e instanceof Error ? e.message : String(e),
        },
      }).catch(() => undefined);
    }
  } catch (e) {
    // Outer guard: anything not caught above (e.g. settings query throws)
    // becomes a single audit row. Status flip is already committed.
    await writeContractEvent(supabase, {
      contractId: contract.id,
      eventType: "email_delivered",
      metadata: {
        kind: "customer_confirmation",
        error: `finalize email dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    }).catch(() => undefined);
  }

  return { signedPdfPath: stampedPath };
}
