import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { EMPTY_HTML, EMPTY_HTML_SHA256 } from "@/lib/contracts/constants";

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
export async function POST(request: Request) {
  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const supabase = createServiceClient();

  const { data: tpl, error: tErr } = await supabase
    .from("contract_templates")
    .select("id, name, pdf_storage_path, version, is_active, signer_role_label")
    .eq("id", body.templateId)
    .maybeSingle<{
      id: string;
      name: string;
      pdf_storage_path: string | null;
      version: number;
      is_active: boolean;
      signer_role_label: string | null;
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
    p_sent_by: user.id,
    p_signers: signersPayload,
  });
  if (rpcErr) {
    return NextResponse.json(
      { error: `Failed to create contract: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ contractId });
}
