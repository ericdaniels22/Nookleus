import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { requirePermission } from "@/lib/permissions-api";
import { createServiceClient } from "@/lib/supabase-api";
import { apiDbError } from "@/lib/api-errors";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const gate = await requirePermission(supabase, "manage_contract_templates");
  if (!gate.ok) return gate.response;
  const orgId = await getActiveOrganizationId(supabase);

  const formData = await req.formData();
  const file = formData.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file_too_large", max_bytes: MAX_BYTES }, { status: 413 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "invalid_content_type" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let pageCount: number;
  let pdfPages: { page: number; width_pt: number; height_pt: number }[];
  try {
    const doc = await PDFDocument.load(bytes);
    pageCount = doc.getPageCount();
    pdfPages = Array.from({ length: pageCount }, (_, i) => {
      const p = doc.getPage(i);
      return { page: i + 1, width_pt: p.getWidth(), height_pt: p.getHeight() };
    });
  } catch (err) {
    return NextResponse.json({ error: "pdf_parse_failed", detail: String(err) }, { status: 400 });
  }

  // Verify the row exists and belongs to this org. Capture current version
  // so we can bump it atomically.
  const { data: existing, error: selectErr } = await supabase
    .from("contract_templates")
    .select("id, version")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (selectErr) return apiDbError(selectErr.message, "POST template/[id]/pdf select");
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = `${orgId}/templates/${id}.pdf`;
  const service = createServiceClient();
  const { error: uploadErr } = await service.storage
    .from("contract-pdfs")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadErr) return apiDbError(uploadErr.message, "POST template/[id]/pdf upload");

  // Replacing the source PDF clears overlay_fields (positions are tied to the
  // old PDF's pages). Bump version application-side, mirroring the existing
  // PATCH route.
  const { data: updated, error: updateErr } = await supabase
    .from("contract_templates")
    .update({
      pdf_storage_path: path,
      pdf_page_count: pageCount,
      pdf_pages: pdfPages,
      overlay_fields: [],
      version: (existing.version ?? 1) + 1,
    })
    .eq("id", id)
    .select()
    .single();
  if (updateErr) return apiDbError(updateErr.message, "POST template/[id]/pdf update");

  return NextResponse.json({ template: updated });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const orgId = await getActiveOrganizationId(supabase);

  const { data: tpl, error } = await supabase
    .from("contract_templates")
    .select("pdf_storage_path")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return apiDbError(error.message, "GET template/[id]/pdf select");
  if (!tpl?.pdf_storage_path) return NextResponse.json({ error: "no_pdf" }, { status: 404 });

  const service = createServiceClient();
  const { data: signed, error: signErr } = await service.storage
    .from("contract-pdfs")
    .createSignedUrl(tpl.pdf_storage_path, 60);
  if (signErr || !signed) return apiDbError(signErr?.message ?? "sign_failed", "GET template/[id]/pdf sign");

  return NextResponse.json({ url: signed.signedUrl });
}
