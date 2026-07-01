import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { applyMergeFieldValues } from "@/lib/contracts/merge-fields";
import { renderBrandedContractEmail } from "@/lib/contracts/branded-email";
import type { ContractEmailFrameInput } from "@/lib/contracts/email-frame";
import type { ContractEmailSettings } from "@/lib/contracts/types";

type PreviewKind = ContractEmailFrameInput["kind"];
const PREVIEW_KINDS: readonly PreviewKind[] = ["signing_request", "reminder"];

interface PreviewBody {
  jobId?: string;
  kind?: string;
  // Unsaved editor state overlaid on the persisted settings so the preview
  // reflects what the contractor is looking at right now (ADR 0017 §6).
  draftSettings?: Partial<ContractEmailSettings>;
  // The Send dialog knows the document title for the selected job; the
  // Settings preview has none and falls back to a sample.
  documentTitle?: string;
}

// The link injected into the card's action button. A preview is never sent, so
// it points at a non-functional sample path — the point is the shape of the
// card, not a live signing session.
function previewSigningLink(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.example.com").replace(/\/$/, "");
  return `${base}/sign/preview`;
}

// Stand-in merge values for the Settings preview, which is not scoped to a job.
// The Send-dialog preview passes a jobId and resolves the real values instead.
function sampleMergeValues(signingLink: string, documentTitle: string): Record<string, string> {
  return {
    customer_name: "Sample Customer",
    document_title: documentTitle,
    signing_link: signingLink,
  };
}

// Overlay only the fields that shape the rendered card. Everything else in a
// draftSettings payload (ids, provider, timestamps) is ignored, and an invalid
// button color is dropped so a mid-edit hex never breaks the preview.
function applyDraftOverlay(
  persisted: ContractEmailSettings,
  draft: Partial<ContractEmailSettings> | undefined,
): ContractEmailSettings {
  if (!draft) return persisted;
  const merged: ContractEmailSettings = { ...persisted };
  const stringFields: Array<keyof ContractEmailSettings> = [
    "button_label",
    "signing_request_subject_template",
    "signing_request_body_template",
    "reminder_subject_template",
    "reminder_body_template",
    "send_from_name",
    "send_from_email",
  ];
  for (const f of stringFields) {
    if (typeof draft[f] === "string") (merged as unknown as Record<string, unknown>)[f] = draft[f];
  }
  if (typeof draft.button_color === "string" && /^#[0-9a-fA-F]{6}$/.test(draft.button_color)) {
    merged.button_color = draft.button_color;
  }
  if (typeof draft.logo_visible === "boolean") {
    merged.logo_visible = draft.logo_visible;
  }
  return merged;
}

// POST /api/contracts/email-preview
//
// Renders the real branded card for a (job, kind, unsaved draft settings) and
// returns its HTML — the shared engine behind the Settings live preview and the
// Send dialog's "Preview email" button (PRD Module F, ADR 0017 §6). It reuses
// the exact send-path composition (resolve merge fields → sanitize → frame),
// so the preview cannot drift from what actually goes out.
//
// Gated on `edit_jobs` OR `access_settings` (any-of): the Send dialog is a
// contract-send surface, the Settings editor a settings surface — both audiences
// may preview. Read-only; nothing is persisted or sent. Service client resolves
// settings + merge data scoped to the caller's Active Organization.
export const POST = withRequestContext(
  { permission: ["edit_jobs", "access_settings"], serviceClient: true },
  async (request, ctx) => {
    const body = (await request.json().catch(() => null)) as PreviewBody | null;
    if (!body) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }

    const kind = (body.kind ?? "signing_request") as PreviewKind;
    if (!PREVIEW_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${PREVIEW_KINDS.join(", ")}` },
        { status: 400 },
      );
    }

    const supabase = ctx.serviceClient!;
    const orgId = ctx.orgId;
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    const { data: persisted, error: sErr } = await supabase
      .from("contract_email_settings")
      .select("*")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    if (sErr || !persisted) {
      return NextResponse.json(
        { error: sErr?.message || "Contract email settings missing" },
        { status: 500 },
      );
    }

    const settings = applyDraftOverlay(persisted, body.draftSettings);
    const signingLink = previewSigningLink();
    const documentTitle = body.documentTitle?.trim() || "Sample Document";

    const bodyTemplate =
      kind === "reminder"
        ? settings.reminder_body_template
        : settings.signing_request_body_template;
    const subjectTemplate =
      kind === "reminder"
        ? settings.reminder_subject_template
        : settings.signing_request_subject_template;

    // Resolve the contractor's message: against the real job when the Send
    // dialog supplies one, against sample values for the job-less Settings
    // preview.
    let message: string;
    if (body.jobId) {
      const resolved = await resolveEmailTemplate(
        supabase,
        subjectTemplate,
        bodyTemplate,
        body.jobId,
        { signing_link: signingLink, document_title: documentTitle },
      );
      message = resolved.html;
    } else {
      message = applyMergeFieldValues(
        bodyTemplate,
        sampleMergeValues(signingLink, documentTitle),
      ).html;
    }

    // Same composition as the send paths: sanitize the message, then assemble
    // the app-owned frame around it (branded-email.ts). The preview shares the
    // renderer, so it can't drift from the delivered email.
    const html = await renderBrandedContractEmail(supabase, settings, {
      kind,
      organizationId: orgId,
      message,
      actionUrl: signingLink,
      documentTitle,
    });

    return NextResponse.json({ html });
  },
);
