// src/lib/pdf-layout.ts — the per-document PDF layout core (#482).
//
// A *PDF layout* is a per-document snapshot of the look a document renders with
// (ADR 0012). This module holds the pure pieces the whole feature renders
// through: the freeze predicate, the precedence resolver, and the payload
// validator. No I/O — every function here is pure and unit-tested.

import type { DocumentPdfLayout, DocumentType, PdfPreset } from "./types";

// Built-in field defaults — the last resort when a document has neither its own
// layout nor an Organization default preset. Mirrors the `pdf_presets` column
// defaults (migrations build67c1 + 382a): every toggle on except
// `show_category_subtotals`. `show_document_title` defaults on because the title
// renders unconditionally today. `document_title` is a generic placeholder; in
// every real render path a preset supplies the actual title.
export const LAYOUT_FIELD_DEFAULTS: DocumentPdfLayout = {
  document_title: "Document",
  show_document_title: true,
  show_markup: true,
  show_discount: true,
  show_tax: true,
  show_opening_statement: true,
  show_closing_statement: true,
  show_category_subtotals: false,
  show_code_column: true,
  show_item_notes: true,
};

// Whether a document's layout is frozen, reusing the freeze boundary ADR 0007
// draws: an estimate locks once it is `converted`; an invoice locks once it is
// `paid` or `voided`. A *voided estimate* is terminal but never became an
// invoice, so its layout stays editable. Pure over (kind, status).
export function isLayoutLocked(kind: DocumentType, status: string): boolean {
  if (kind === "estimate") return status === "converted";
  return status === "paid" || status === "voided";
}

// Resolve a document's effective look. Precedence, per field: the document's own
// layout wins; else the Organization's default preset; else the built-in field
// defaults. Always returns a complete `DocumentPdfLayout` — the render path must
// never have "no look."
export function resolveEffectiveLayout(
  layout: DocumentPdfLayout | null,
  preset: PdfPreset | null,
  defaults: DocumentPdfLayout = LAYOUT_FIELD_DEFAULTS,
): DocumentPdfLayout {
  // The preset is the per-field fallback below a document's own layout. It
  // carries every layout field except `show_document_title` (new in #482, no
  // preset column), so that one always falls through to the field default.
  const fromPreset: Partial<DocumentPdfLayout> = preset
    ? {
        document_title: preset.document_title,
        show_markup: preset.show_markup,
        show_discount: preset.show_discount,
        show_tax: preset.show_tax,
        show_opening_statement: preset.show_opening_statement,
        show_closing_statement: preset.show_closing_statement,
        show_category_subtotals: preset.show_category_subtotals,
        show_code_column: preset.show_code_column,
        show_item_notes: preset.show_item_notes,
      }
    : {};

  // Per-field precedence: document layout > preset > field default. A layout
  // present but missing a field (`undefined`) falls through, not "off".
  const pick = <K extends keyof DocumentPdfLayout>(key: K): DocumentPdfLayout[K] => {
    const fromLayout = layout?.[key];
    if (fromLayout !== undefined) return fromLayout;
    const presetVal = fromPreset[key];
    if (presetVal !== undefined) return presetVal;
    return defaults[key];
  };

  return {
    document_title: pick("document_title"),
    show_document_title: pick("show_document_title"),
    show_markup: pick("show_markup"),
    show_discount: pick("show_discount"),
    show_tax: pick("show_tax"),
    show_opening_statement: pick("show_opening_statement"),
    show_closing_statement: pick("show_closing_statement"),
    show_category_subtotals: pick("show_category_subtotals"),
    show_code_column: pick("show_code_column"),
    show_item_notes: pick("show_item_notes"),
  };
}

// Snapshot a saved preset's choices onto a document's own layout (#486). Per
// ADR 0012 applying a preset is a *copy*, never a binding link — the document
// gets its own complete layout, so later edits to the preset never reach back
// into it. The preset carries the eight shared toggles + the title but has no
// `show_document_title` column, so that one document-level field is preserved
// from the document's current look (default: the field default) rather than
// silently reset. Pure.
export function presetToLayout(
  preset: PdfPreset,
  currentShowDocumentTitle: boolean = LAYOUT_FIELD_DEFAULTS.show_document_title,
): DocumentPdfLayout {
  return {
    document_title: preset.document_title,
    show_document_title: currentShowDocumentTitle,
    show_markup: preset.show_markup,
    show_discount: preset.show_discount,
    show_tax: preset.show_tax,
    show_opening_statement: preset.show_opening_statement,
    show_closing_statement: preset.show_closing_statement,
    show_category_subtotals: preset.show_category_subtotals,
    show_code_column: preset.show_code_column,
    show_item_notes: preset.show_item_notes,
  };
}

// Validate an untrusted PATCH body into a `DocumentPdfLayout`. Accepts only a
// well-formed layout — exactly the nine boolean toggles plus a string
// `document_title` — and returns it normalized (extra keys stripped) so only the
// canonical shape ever reaches the JSONB column. Returns null on any violation.
// The nine boolean toggles that, with `document_title`, make up a layout. Used
// to validate and normalize a payload field-by-field.
const LAYOUT_TOGGLE_KEYS = [
  "show_document_title",
  "show_markup",
  "show_discount",
  "show_tax",
  "show_opening_statement",
  "show_closing_statement",
  "show_category_subtotals",
  "show_code_column",
  "show_item_notes",
] as const;

// Server-side cap on the title text, matching the panel's `maxLength={200}`
// (live-layout-panel.tsx). The client attribute is bypassable, so enforce the
// same bound here before an oversized title can reach the JSONB column / the PDF.
export const DOCUMENT_TITLE_MAX_LENGTH = 200;

export function parseLayoutPayload(body: unknown): DocumentPdfLayout | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const obj = body as Record<string, unknown>;

  if (
    typeof obj.document_title !== "string" ||
    obj.document_title.length > DOCUMENT_TITLE_MAX_LENGTH
  ) {
    return null;
  }

  const toggles = {} as Record<(typeof LAYOUT_TOGGLE_KEYS)[number], boolean>;
  for (const key of LAYOUT_TOGGLE_KEYS) {
    if (typeof obj[key] !== "boolean") return null;
    toggles[key] = obj[key] as boolean;
  }

  // Normalize: emit exactly the canonical shape, dropping any extra keys so only
  // a well-formed layout ever reaches the JSONB column.
  return { document_title: obj.document_title, ...toggles };
}
