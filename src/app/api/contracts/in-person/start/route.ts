import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { EMPTY_HTML, EMPTY_HTML_SHA256 } from "@/lib/contracts/constants";
import { buildMergeFieldRawValues } from "@/lib/contracts/merge-fields";
import { evaluateAutoCheckboxes } from "@/lib/contracts/auto-checkbox-evaluator";
import type { OverlayField } from "@/lib/contracts/types";

interface SignerInput {
  name: string;
  email: string;
  roleLabel?: string;
}

interface StartBody {
  jobId: string;
  templateId: string;
  signers: SignerInput[];
  title?: string;
}

// POST /api/contracts/in-person/start
// Creates a draft contract + signer rows for the in-person (iPad) flow.
// No link_token, no expiry, no email. Caller redirects to the internal
// /contracts/[id]/sign-in-person route once this returns.
//
// Logged-in only; the Service client creates the draft contract.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as StartBody | null;
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

    const supabase = ctx.serviceClient!;

    const { data: tpl, error: tErr } = await supabase
      .from("contract_templates")
      .select("id, name, pdf_storage_path, version, is_active, signer_role_label, overlay_fields")
      .eq("id", body.templateId)
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

    const { data: job, error: jErr } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", body.jobId)
      .maybeSingle();
    if (jErr || !job) {
      return NextResponse.json({ error: jErr?.message || "Job not found" }, { status: 404 });
    }

    const filledHtml = EMPTY_HTML;
    const filledHash = EMPTY_HTML_SHA256;

    const contractId = randomUUID();
    const signerIds = body.signers.map(() => randomUUID());
    const primary = body.signers[0];
    const title = (body.title?.trim() || `${tpl.name} — ${primary.name}`).slice(0, 200);

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
      p_link_token: null,
      p_link_expires_at: null,
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
    // See /api/contracts/send/route.ts for the analogous block; iPad in-person
    // contracts use the same evaluation path so the signer sees the right
    // pre-ticked state when the device opens the sign page.
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
        console.error("[contracts/in-person/start] auto-checkbox evaluation failed", {
          contractId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({ contractId });
  },
);
