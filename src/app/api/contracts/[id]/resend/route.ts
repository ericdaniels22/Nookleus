import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { generateSigningToken } from "@/lib/contracts/tokens";
import { resolveEmailTemplate } from "@/lib/contracts/email-merge-fields";
import { sendContractEmail } from "@/lib/contracts/email";
import { renderBrandedContractEmail } from "@/lib/contracts/branded-email";
import type { Contract, ContractSigner, ContractEmailSettings } from "@/lib/contracts/types";

function appUrl(): string {
  const u = process.env.NEXT_PUBLIC_APP_URL;
  if (!u) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return u.replace(/\/$/, "");
}

// POST /api/contracts/[id]/resend
// Body: { expiryDays?: number }
// Issues a fresh token, bumps the expiry, re-sends the signing-request
// email. Used for 'expired' contracts (the Resend row action) and the
// Remind action on active ones if the user wants to push a new link.
//
// Requires `edit_jobs` (#106) — contracts are gated on the job permissions.
// The Service client regenerates the token and re-sends.
export const POST = withRequestContext(
  { permission: "edit_jobs", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { expiryDays?: number };
    const supabase = ctx.serviceClient!;

    const { data: settings } = await supabase
      .from("contract_email_settings")
      .select("*")
      .limit(1)
      .maybeSingle<ContractEmailSettings>();
    if (!settings) {
      return NextResponse.json({ error: "Email settings missing" }, { status: 500 });
    }
    if (!settings.send_from_email || !settings.send_from_name) {
      return NextResponse.json(
        { error: "Set a send-from email and display name in Settings → Contracts." },
        { status: 400 },
      );
    }

    const { data: contract } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", id)
      .maybeSingle<Contract>();
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.status === "signed" || contract.status === "voided") {
      return NextResponse.json(
        { error: "Only sent / viewed / expired contracts can be resent" },
        { status: 409 },
      );
    }

    const { data: signers } = await supabase
      .from("contract_signers")
      .select("*")
      .eq("contract_id", contract.id)
      .order("signer_order");
    const primary = (signers as ContractSigner[] | null)?.[0];
    if (!primary) {
      return NextResponse.json({ error: "Contract has no signers" }, { status: 500 });
    }

    const expiryDays = Math.max(
      1,
      Math.min(30, body.expiryDays ?? settings.default_link_expiry_days),
    );
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const token = generateSigningToken({
      contractId: contract.id,
      signerId: primary.id,
      expiresAt,
    });

    const { error: rpcErr } = await supabase.rpc("resend_contract_link", {
      p_contract_id: contract.id,
      p_link_token: token,
      p_link_expires_at: expiresAt.toISOString(),
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    try {
      const signingLink = `${appUrl()}/sign/${token}`;
      const { subject, html: message } = await resolveEmailTemplate(
        supabase,
        settings.signing_request_subject_template,
        settings.signing_request_body_template,
        contract.job_id,
        {
          signing_link: signingLink,
          document_title: contract.title,
        },
      );

      // Resend re-sends the *initial* signing request, so it wears the same
      // branded card and signing-link button as the first send (#692, ADR
      // 0017 §3/§4).
      const html = await renderBrandedContractEmail(supabase, settings, {
        kind: "signing_request",
        organizationId: contract.organization_id,
        message,
        actionUrl: signingLink,
        documentTitle: contract.title,
      });

      await sendContractEmail(supabase, settings, {
        to: primary.email,
        subject,
        html,
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json(
        { error: `Token regenerated but email failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 },
      );
    }
  },
);
