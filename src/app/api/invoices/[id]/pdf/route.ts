// src/app/api/invoices/[id]/pdf/route.ts — render → upload → signed URL.
//
// Build 67c2: body extracted into renderAndUploadInvoicePdf so the new
// send routes can share the exact rendering / Storage path. The route
// keeps the "no body.preset_id → use default preset" fallback and the
// public response shape `{ download_url, storage_path, filename }`.

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { getDefaultPreset } from "@/lib/pdf-presets";
import { renderAndUploadInvoicePdf } from "@/lib/pdf-renderer/render-and-upload";
import { apiError } from "@/lib/api-errors";

interface PdfRequestBody { preset_id?: string; }

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_invoices");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const orgId = await getActiveOrganizationId(supabase);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

  let body: PdfRequestBody = {};
  try { body = (await request.json().catch(() => ({}))) as PdfRequestBody; }
  catch { /* empty body OK; default preset will be used */ }

  let presetId = body.preset_id;
  if (!presetId) {
    const def = await getDefaultPreset(supabase, "invoice");
    if (!def) {
      return NextResponse.json(
        { error: "preset not found (and no default seeded)" },
        { status: 400 },
      );
    }
    presetId = def.id;
  }

  try {
    const result = await renderAndUploadInvoicePdf({
      supabase,
      invoiceId: id,
      presetId,
      orgId,
    });
    return NextResponse.json({
      download_url: result.download_url,
      storage_path: result.storage_path,
      filename: result.filename,
    });
  } catch (e) {
    return apiError(e, "POST /api/invoices/[id]/pdf");
  }
}
