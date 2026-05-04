// src/app/api/pdf-presets/[id]/route.ts — GET, PUT (incl. is_default flip), DELETE

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission, requireAnyPermission } from "@/lib/permissions-api";
import { getPreset, updatePreset, deletePreset } from "@/lib/pdf-presets";
import { apiError } from "@/lib/api-errors";
import type { PdfPresetUpdatePayload } from "@/lib/types";

const BOOL_FIELDS: (keyof PdfPresetUpdatePayload)[] = [
  "show_markup",
  "show_discount",
  "show_tax",
  "show_opening_statement",
  "show_closing_statement",
  "show_category_subtotals",
  "show_code_column",
  "show_notes_column",
  "is_default",
];

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requireAnyPermission(supabase, ["view_estimates", "view_invoices"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    const preset = await getPreset(supabase, id);
    if (!preset) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ preset });
  } catch (e) {
    return apiError(e, "GET /api/pdf-presets/[id]");
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_pdf_presets");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const body = raw as PdfPresetUpdatePayload;

  // Validate strings if present.
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name must be non-empty string" }, { status: 400 });
    }
    if (body.name.length > 200) {
      return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
    }
    body.name = body.name.trim();
  }
  if (body.document_title !== undefined) {
    if (typeof body.document_title !== "string" || !body.document_title.trim()) {
      return NextResponse.json({ error: "document_title must be non-empty string" }, { status: 400 });
    }
    if (body.document_title.length > 200) {
      return NextResponse.json({ error: "document_title too long (max 200)" }, { status: 400 });
    }
    body.document_title = body.document_title.trim();
  }

  // Validate booleans if present — runtime check (TS types don't enforce at runtime).
  // A non-boolean value would otherwise reach Postgres as the wrong shape and 500.
  for (const field of BOOL_FIELDS) {
    const v = body[field];
    if (v !== undefined && typeof v !== "boolean") {
      return NextResponse.json({ error: `${field} must be boolean` }, { status: 400 });
    }
  }

  try {
    const preset = await updatePreset(supabase, id, body);
    return NextResponse.json({ preset });
  } catch (e) {
    if (e instanceof Error && e.message === "preset not found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return apiError(e, "PUT /api/pdf-presets/[id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "manage_pdf_presets");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  try {
    await deletePreset(supabase, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "preset not found") {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      if (e.message === "cannot delete default preset") {
        return NextResponse.json({ error: "cannot delete default preset" }, { status: 409 });
      }
    }
    return apiError(e, "DELETE /api/pdf-presets/[id]");
  }
}
