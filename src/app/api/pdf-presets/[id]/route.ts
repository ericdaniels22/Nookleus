// src/app/api/pdf-presets/[id]/route.ts — GET, PUT (incl. is_default flip), DELETE

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { getPreset, updatePreset, deletePreset } from "@/lib/pdf-presets";
import { apiError } from "@/lib/api-errors";
import type { PdfPresetUpdatePayload } from "@/lib/types";

// Compile-time guard: only boolean-typed keys can land in BOOL_FIELDS.
// If a future PdfPresetUpdatePayload field is non-boolean, adding it here is a tsc error.
type BoolKeys = {
  [K in keyof PdfPresetUpdatePayload]-?: PdfPresetUpdatePayload[K] extends boolean | undefined ? K : never;
}[keyof PdfPresetUpdatePayload];

const BOOL_FIELDS: BoolKeys[] = [
  "show_markup",
  "show_discount",
  "show_tax",
  "show_opening_statement",
  "show_closing_statement",
  "show_category_subtotals",
  "show_code_column",
  "show_item_notes",
  "is_default",
];

// 200-char cap on `name` and `document_title` is API-side sanity only;
// the underlying columns are `text` (uncapped). Sized for typical preset names.
const MAX_TEXT_LEN = 200;

// Reading a preset needs either the estimates or the invoices view
// permission (admins auto-pass) — mapped 1:1 from the old gate.
export const GET = withRequestContext(
  { permission: ["view_estimates", "view_invoices"] },
  async (_request, ctx, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    try {
      const preset = await getPreset(ctx.supabase, id);
      if (!preset) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ preset });
    } catch (e) {
      return apiError(e, "GET /api/pdf-presets/[id]");
    }
  },
);

// Updating a preset needs the `manage_pdf_presets` permission (admins
// auto-pass) — mapped 1:1 from the old gate.
export const PUT = withRequestContext(
  { permission: "manage_pdf_presets" },
  async (request, ctx, context: { params: Promise<{ id: string }> }) => {
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
      if (body.name.length > MAX_TEXT_LEN) {
        return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
      }
      body.name = body.name.trim();
    }
    if (body.document_title !== undefined) {
      if (typeof body.document_title !== "string" || !body.document_title.trim()) {
        return NextResponse.json({ error: "document_title must be non-empty string" }, { status: 400 });
      }
      if (body.document_title.length > MAX_TEXT_LEN) {
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
      const preset = await updatePreset(ctx.supabase, id, body);
      return NextResponse.json({ preset });
    } catch (e) {
      if (e instanceof Error && e.message === "preset not found") {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return apiError(e, "PUT /api/pdf-presets/[id]");
    }
  },
);

// Deleting a preset needs the `manage_pdf_presets` permission (admins
// auto-pass) — mapped 1:1 from the old gate.
export const DELETE = withRequestContext(
  { permission: "manage_pdf_presets" },
  async (_request, ctx, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    try {
      await deletePreset(ctx.supabase, id);
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
  },
);
