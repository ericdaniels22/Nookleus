// src/app/api/pdf-presets/route.ts — GET list, POST create

import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { listPresets, createPreset } from "@/lib/pdf-presets";
import { apiError } from "@/lib/api-errors";
import type { DocumentType, PdfPresetCreatePayload } from "@/lib/types";

const VALID_DOC_TYPES: DocumentType[] = ["estimate", "invoice"];

function isValidDocType(v: unknown): v is DocumentType {
  return typeof v === "string" && VALID_DOC_TYPES.includes(v as DocumentType);
}

function asBool(v: unknown, defaultValue: boolean): boolean {
  return typeof v === "boolean" ? v : defaultValue;
}

// Listing presets needs either the estimates or the invoices view
// permission (admins auto-pass) — mapped 1:1 from the old
// requireAnyPermission gate.
export const GET = withRequestContext(
  { permission: ["view_estimates", "view_invoices"] },
  async (request, ctx) => {
    const url = new URL(request.url);
    const dtRaw = url.searchParams.get("document_type");
    let documentType: DocumentType | undefined;
    if (dtRaw !== null) {
      if (!isValidDocType(dtRaw)) {
        return NextResponse.json({ error: "document_type must be estimate|invoice" }, { status: 400 });
      }
      documentType = dtRaw;
    }
    try {
      const presets = await listPresets(ctx.supabase, documentType);
      return NextResponse.json({ presets });
    } catch (e) {
      return apiError(e, "GET /api/pdf-presets list");
    }
  },
);

// Creating a preset needs the `manage_pdf_presets` permission (admins
// auto-pass) — mapped 1:1 from the old requirePermission gate.
export const POST = withRequestContext(
  { permission: "manage_pdf_presets" },
  async (request, ctx) => {
    let raw: unknown;
    try { raw = await request.json(); }
    catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const body = raw as Partial<PdfPresetCreatePayload>;

    // Required string fields
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }
    if (typeof body.document_title !== "string" || !body.document_title.trim()) {
      return NextResponse.json({ error: "document_title required" }, { status: 400 });
    }
    if (!isValidDocType(body.document_type)) {
      return NextResponse.json({ error: "document_type must be estimate|invoice" }, { status: 400 });
    }

    const name = body.name.trim();
    if (name.length > 200) return NextResponse.json({ error: "name too long (max 200)" }, { status: 400 });
    const documentTitle = body.document_title.trim();
    if (documentTitle.length > 200) return NextResponse.json({ error: "document_title too long (max 200)" }, { status: 400 });

    // Boolean fields default to spec defaults if absent or not a boolean.
    // Note: createPreset() in @/lib/pdf-presets atomically demotes any prior
    // default for (org, document_type) when is_default is true.
    const payload: PdfPresetCreatePayload = {
      name,
      document_type: body.document_type,
      document_title: documentTitle,
      show_markup: asBool(body.show_markup, true),
      show_discount: asBool(body.show_discount, true),
      show_tax: asBool(body.show_tax, true),
      show_opening_statement: asBool(body.show_opening_statement, true),
      show_closing_statement: asBool(body.show_closing_statement, true),
      show_category_subtotals: asBool(body.show_category_subtotals, false),
      show_code_column: asBool(body.show_code_column, true),
      show_item_notes: asBool(body.show_item_notes, true),
      is_default: asBool(body.is_default, false),
    };

    const orgId = ctx.orgId;
    if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 400 });

    try {
      const preset = await createPreset(ctx.supabase, orgId, ctx.userId, payload);
      return NextResponse.json({ preset }, { status: 201 });
    } catch (e) {
      return apiError(e, "POST /api/pdf-presets create");
    }
  },
);
