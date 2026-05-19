import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { generateSigningToken } from "@/lib/contracts/tokens";
import { computeInitialNextReminderAt } from "@/lib/contracts/reminders";
import type { ContractEmailSettings, OverlayField } from "@/lib/contracts/types";
import { EMPTY_HTML, EMPTY_HTML_SHA256 } from "@/lib/contracts/constants";
import { buildMergeFieldRawValues } from "@/lib/contracts/merge-fields";
import { evaluateAutoCheckboxes } from "@/lib/contracts/auto-checkbox-evaluator";

interface SendSignerInput {
  name: string;
  email: string;
  roleLabel?: string;
}

interface SendBody {
  jobId: string;
  templateId: string;
  signers: SendSignerInput[];
  expiryDays?: number;
  emailSubject: string;
  emailBody: string;
  title?: string;
}

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

// POST /api/contracts/send
// Build 15c extensions over 15b:
//   - Supports up to 2 signers. In multi-signer mode, only signer 1
//     receives the initial email; signer 2 is emailed after signer 1
//     completes (see /api/contracts/[id]/sign → activate_next_signer).
//   - Stamps the initial next_reminder_at so the hourly cron can pick
//     the contract up once the first offset elapses.
//
// Requires `edit_jobs` (#106) — sending a contract is a job-edit-class
// mutation; the contracts area is gated on the job permissions. The Service
// client creates the draft + sends the email, scoped to the caller's Active
// Organization.
export const POST = withRequestContext(
  { permission: "edit_jobs", serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as SendBody | null;
    if (!body?.jobId || !body?.templateId || !Array.isArray(body?.signers) || !body.signers.length) {
      return NextResponse.json(
        { error: "jobId, templateId, and at least one signer are required" },
        { status: 400 },
      );
    }
    if (body.signers.length > 2) {
      return NextResponse.json({ error: "At most 2 signers" }, { status: 400 });
    }
    for (const s of body.signers) {
      if (!s.name?.trim() || !s.email?.trim()) {
        return NextResponse.json(
          { error: "Every signer needs a name and email" },
          { status: 400 },
        );
      }
    }
    if (!body.emailSubject || !body.emailBody) {
      return NextResponse.json(
        { error: "emailSubject and emailBody are required" },
        { status: 400 },
      );
    }
    // Guard-rail: the email body must contain the signing-link merge field
    // (either as a {{signing_link}} token or a Tiptap pill with
    // data-field-name="signing_link"). Without it, the resolver has nothing to
    // substitute and the recipient gets an email with no way to sign.
    const hasSigningLinkToken =
      body.emailBody.includes("{{signing_link}}") ||
      /data-field-name=["']signing_link["']/i.test(body.emailBody);
    if (!hasSigningLinkToken) {
      return NextResponse.json(
        { error: "Email body must contain the {{signing_link}} placeholder so the recipient gets a sign-in link." },
        { status: 400 },
      );
    }

    const supabase = ctx.serviceClient!;
    const orgId = ctx.orgId;

    // --- Fetch settings ---
    const { data: settings, error: sErr } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    if (sErr || !settings) {
      return NextResponse.json(
        { error: sErr?.message || "Contract email settings missing" },
        { status: 500 },
      );
    }
    if (!settings.send_from_email || !settings.send_from_name) {
      return NextResponse.json(
        { error: "Set a send-from email and display name in Settings → Contracts before sending." },
        { status: 400 },
      );
    }

    // --- Fetch template ---
    const { data: tpl, error: tErr } = await supabase
      .from("contract_templates")
      .select("id, name, pdf_storage_path, version, is_active, signer_role_label, overlay_fields")
      .eq("id", body.templateId)
      .eq("organization_id", orgId)
      .maybeSingle<{
        id: string;
        name: string;
        pdf_storage_path: string | null;
        version: number;
        is_active: boolean;
        signer_role_label: string | null;
        overlay_fields: OverlayField[] | null;
      }>();
    if (tErr || !tpl) {
      return NextResponse.json({ error: tErr?.message || "Template not found" }, { status: 404 });
    }
    if (!tpl.is_active) {
      return NextResponse.json({ error: "Template is archived" }, { status: 400 });
    }
    if (!tpl.pdf_storage_path) {
      return NextResponse.json({ error: "Template has no PDF" }, { status: 400 });
    }

    // --- Confirm the job exists ---
    const { data: job, error: jErr } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", body.jobId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (jErr || !job) {
      return NextResponse.json({ error: jErr?.message || "Job not found" }, { status: 404 });
    }

    const filledHtml = EMPTY_HTML;
    const filledHash = EMPTY_HTML_SHA256;

    // --- Compute IDs, token, expiry ---
    const contractId = randomUUID();
    const signerIds = body.signers.map(() => randomUUID());
    const primary = body.signers[0];
    const primarySignerId = signerIds[0];

    const expiryDays = Math.max(
      1,
      Math.min(30, body.expiryDays ?? settings.default_link_expiry_days),
    );
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const token = generateSigningToken({
      contractId,
      signerId: primarySignerId,
      expiresAt,
    });

    const title = (body.title?.trim() || `${tpl.name} — ${primary.name}`).slice(0, 200);

    // --- Create draft + all signer rows atomically ---
    const signersPayload = body.signers.map((s, idx) => ({
      id: signerIds[idx],
      signer_order: idx + 1,
      role_label: s.roleLabel || tpl.signer_role_label || "Signer",
      name: s.name.trim(),
      email: s.email.trim(),
    }));

    const { error: rpcErr } = await supabase.rpc("create_contract_with_signers", {
      p_contract_id: contractId,
      p_job_id: body.jobId,
      p_template_id: tpl.id,
      p_template_version: tpl.version,
      p_title: title,
      p_filled_content_html: filledHtml,
      p_filled_content_hash: filledHash,
      p_link_token: token,
      p_link_expires_at: expiresAt.toISOString(),
      p_sent_by: ctx.userId,
      p_signers: signersPayload,
    });
    if (rpcErr) {
      return NextResponse.json(
        { error: `Failed to create contract: ${rpcErr.message}` },
        { status: 500 },
      );
    }

    // --- Auto-fill checkboxes bound to intake data ---
    // Stamp the pre-determined ticks into customer_inputs at draft time so the
    // signer view can render them as locked/non-interactive and the eventual
    // stamped PDF reflects them. The RPC has no customer_inputs param so we
    // patch separately; this is a no-op when the template has no auto-bound
    // checkboxes.
    const overlayFields = tpl.overlay_fields ?? [];
    const hasAutoFill = overlayFields.some(
      (f) => f.type === "checkbox" && f.autoFillBinding,
    );
    if (hasAutoFill) {
      try {
        const resolvedValues = await buildMergeFieldRawValues(supabase, body.jobId);
        const evaluation = evaluateAutoCheckboxes(overlayFields, resolvedValues);
        if (Object.keys(evaluation.inputs).length > 0) {
          await supabase
            .from("contracts")
            .update({ customer_inputs: evaluation.inputs })
            .eq("id", contractId);
        }
      } catch (e) {
        // Non-fatal: contract is created, auto-fill just didn't run. The
        // signer will see them as un-ticked.
        console.error("[contracts/send] auto-checkbox evaluation failed", {
          contractId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // --- Resolve email body + send (to signer 1 only) ---
    try {
      const signingLink = `${appUrl()}/sign/${token}`;
      const { subject, html } = await resolveEmailTemplate(
        supabase,
        body.emailSubject,
        body.emailBody,
        body.jobId,
        { signing_link: signingLink, document_title: title },
      );

      const sent = await sendContractEmail(supabase, settings, {
        to: primary.email,
        subject,
        html,
      });

      const { error: markErr } = await supabase.rpc("mark_contract_sent", {
        p_contract_id: contractId,
        p_message_id: sent.messageId,
        p_provider: sent.provider,
      });
      if (markErr) {
        return NextResponse.json(
          {
            error: `Email sent (message ${sent.messageId}) but failed to record status: ${markErr.message}`,
            contractId,
          },
          { status: 500 },
        );
      }

      // --- Schedule first auto-reminder based on settings.reminder_day_offsets ---
      const firstReminder = computeInitialNextReminderAt(
        new Date(),
        settings.reminder_day_offsets,
      );
      if (firstReminder) {
        await supabase.rpc("schedule_first_reminder", {
          p_contract_id: contractId,
          p_next_reminder_at: firstReminder.toISOString(),
        });
      }

      return NextResponse.json({ contractId, messageId: sent.messageId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `Contract draft created but email failed: ${msg}. Retry from the Contracts section.`,
          contractId,
        },
        { status: 502 },
      );
    }
  },
);
