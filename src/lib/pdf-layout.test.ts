import { describe, it, expect } from "vitest";
import {
  isLayoutLocked,
  resolveEffectiveLayout,
  parseLayoutPayload,
  presetToLayout,
  LAYOUT_FIELD_DEFAULTS,
  DOCUMENT_TITLE_MAX_LENGTH,
} from "./pdf-layout";
import type {
  DocumentPdfLayout,
  EstimateStatus,
  Invoice,
  PdfPreset,
} from "./types";

// A complete, deliberately non-default layout so a test that expects the
// document's own look to win can tell it apart from preset/field defaults.
function customLayout(): DocumentPdfLayout {
  return {
    document_title: "Proposal",
    show_document_title: false,
    show_markup: false,
    show_overhead: true, // field default is false (#576) — flipped like the rest
    show_profit: true,
    show_discount: false,
    show_tax: false,
    show_opening_statement: false,
    show_closing_statement: false,
    show_category_subtotals: true,
    show_code_column: false,
    show_item_notes: false,
  };
}

// A preset whose every toggle is the opposite of the field defaults, so a test
// can tell "the preset supplied this" apart from "the field default did".
function customPreset(): PdfPreset {
  return {
    id: "preset-1",
    organization_id: "org-1",
    name: "Branded",
    document_type: "estimate",
    document_title: "Quote",
    show_markup: false,
    show_overhead: true, // field default is false (#576) — flipped like the rest
    show_profit: true,
    show_discount: false,
    show_tax: false,
    show_opening_statement: false,
    show_closing_statement: false,
    show_category_subtotals: true,
    show_code_column: false,
    show_item_notes: false,
    is_default: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// #482 — the per-document layout is frozen exactly where ADR 0007 draws the
// freeze boundary: an estimate locks only once it has been *converted*. Every
// earlier state (including a *voided* estimate, which is terminal but never
// became an invoice) stays editable.
describe("isLayoutLocked — estimate freeze boundary (#482)", () => {
  const ALL_ESTIMATE_STATUSES: EstimateStatus[] = [
    "draft",
    "sent",
    "converted",
    "voided",
  ];

  it("locks an estimate only when it is converted", () => {
    for (const status of ALL_ESTIMATE_STATUSES) {
      expect(isLayoutLocked("estimate", status)).toBe(status === "converted");
    }
  });
});

// An invoice's money has moved (or been voided), so its layout freezes once it
// is `paid` or `voided`. Earlier states (draft / sent / partial) stay editable.
describe("isLayoutLocked — invoice freeze boundary (#482)", () => {
  const ALL_INVOICE_STATUSES: Invoice["status"][] = [
    "draft",
    "sent",
    "partial",
    "paid",
    "voided",
  ];

  it("locks an invoice when it is paid or voided", () => {
    for (const status of ALL_INVOICE_STATUSES) {
      const expected = status === "paid" || status === "voided";
      expect(isLayoutLocked("invoice", status)).toBe(expected);
    }
  });
});

// The precedence engine: document layout > org default preset > field defaults.
// The render path must never have "no look", so the output is always complete.
describe("resolveEffectiveLayout — precedence (#482)", () => {
  it("returns the document's own layout when it has one", () => {
    const layout = customLayout();
    // Even with a preset present, the document's own snapshot wins outright.
    expect(resolveEffectiveLayout(layout, customPreset())).toEqual(layout);
  });

  it("falls back to the org default preset when the layout is NULL", () => {
    const preset = customPreset();
    // The preset carries every field except `show_document_title` (new in #482),
    // which has no preset column — so it falls through to the field default.
    expect(resolveEffectiveLayout(null, preset)).toEqual({
      document_title: preset.document_title,
      show_document_title: LAYOUT_FIELD_DEFAULTS.show_document_title,
      show_markup: preset.show_markup,
      show_overhead: preset.show_overhead,
      show_profit: preset.show_profit,
      show_discount: preset.show_discount,
      show_tax: preset.show_tax,
      show_opening_statement: preset.show_opening_statement,
      show_closing_statement: preset.show_closing_statement,
      show_category_subtotals: preset.show_category_subtotals,
      show_code_column: preset.show_code_column,
      show_item_notes: preset.show_item_notes,
    });
  });

  it("falls back to built-in field defaults when both layout and preset are absent", () => {
    expect(resolveEffectiveLayout(null, null)).toEqual(LAYOUT_FIELD_DEFAULTS);
  });

  it("fills a field the layout is missing from the next precedence level", () => {
    const full = customLayout();
    const { show_tax: _omit, ...partial } = full; // a layout written without show_tax
    void _omit;
    const preset = customPreset(); // preset.show_tax === false; field default is true
    const resolved = resolveEffectiveLayout(partial as DocumentPdfLayout, preset);
    // Fields the layout has still come from the layout.
    expect(resolved.document_title).toBe(full.document_title);
    expect(resolved.show_code_column).toBe(full.show_code_column);
    // The missing field falls through to the preset (false), not "off" and not
    // the field default (true) — proving per-field, not all-or-nothing, merge.
    expect(resolved.show_tax).toBe(false);
  });
});

// #576 — Overhead & Profit get their own show/hide toggles, parallel to
// markup/discount/tax. They default to HIDDEN so legacy documents (and any
// document whose uplifts are zero) don't sprout two empty $0 lines.
describe("resolveEffectiveLayout — Overhead & Profit visibility (#576)", () => {
  it("defaults both new toggles to hidden when neither layout nor preset exists", () => {
    const resolved = resolveEffectiveLayout(null, null);
    expect(resolved.show_overhead).toBe(false);
    expect(resolved.show_profit).toBe(false);
  });

  it("lets a preset that shows Overhead & Profit supply them when the layout is NULL", () => {
    const preset = { ...customPreset(), show_overhead: true, show_profit: true };
    const resolved = resolveEffectiveLayout(null, preset);
    expect(resolved.show_overhead).toBe(true);
    expect(resolved.show_profit).toBe(true);
  });
});

// #486 — applying a saved preset COPIES its choices onto the document's own
// layout (ADR 0012 snapshot, never a binding link). A preset carries the ten
// shared toggles + the title, but has no `show_document_title` column — that one
// document-level field is preserved from the document's current look rather than
// reset, so applying a preset never silently flips the title on or off.
describe("presetToLayout — snapshot a preset's choices onto a document layout (#486)", () => {
  it("copies the preset's ten toggles + title and preserves the current show_document_title", () => {
    const preset = customPreset(); // every toggle the opposite of the field defaults
    // The document currently hides its title; the preset has no opinion on that
    // field, so applying it must leave show_document_title alone.
    expect(presetToLayout(preset, false)).toEqual({
      document_title: preset.document_title,
      show_document_title: false, // preserved from the document, not the preset
      show_markup: preset.show_markup,
      show_overhead: preset.show_overhead, // #576 — copied like the other toggles
      show_profit: preset.show_profit,
      show_discount: preset.show_discount,
      show_tax: preset.show_tax,
      show_opening_statement: preset.show_opening_statement,
      show_closing_statement: preset.show_closing_statement,
      show_category_subtotals: preset.show_category_subtotals,
      show_code_column: preset.show_code_column,
      show_item_notes: preset.show_item_notes,
    });
  });

  it("falls back to the field default for show_document_title when no current value is given", () => {
    expect(presetToLayout(customPreset()).show_document_title).toBe(
      LAYOUT_FIELD_DEFAULTS.show_document_title,
    );
  });

  it("returns exactly the canonical layout shape — no preset-only keys leak through", () => {
    const result = presetToLayout(customPreset(), true);
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(LAYOUT_FIELD_DEFAULTS).sort(),
    );
    for (const leaked of ["id", "organization_id", "is_default", "name", "document_type"]) {
      expect(result).not.toHaveProperty(leaked);
    }
  });
});

// The payload validator guards the PATCH autosave: only a well-formed layout
// (nine booleans + a string title) is accepted; anything else is rejected so a
// malformed body can never reach the JSONB column. Returns the normalized layout
// or null.
describe("parseLayoutPayload — validation (#482)", () => {
  it("accepts a well-formed layout and returns it normalized", () => {
    const payload = customLayout();
    expect(parseLayoutPayload({ ...payload })).toEqual(payload);
  });

  it("rejects non-object bodies", () => {
    for (const bad of [null, undefined, "layout", 42, true, [customLayout()]]) {
      expect(parseLayoutPayload(bad)).toBeNull();
    }
  });

  it("rejects a body missing a required field", () => {
    const { show_markup: _omit, ...partial } = customLayout();
    void _omit;
    expect(parseLayoutPayload(partial)).toBeNull();
  });

  it("rejects a toggle that is not a boolean", () => {
    expect(parseLayoutPayload({ ...customLayout(), show_tax: "true" })).toBeNull();
    expect(parseLayoutPayload({ ...customLayout(), show_markup: 1 })).toBeNull();
  });

  it("rejects a document_title that is not a string", () => {
    expect(parseLayoutPayload({ ...customLayout(), document_title: 7 })).toBeNull();
    const { document_title: _t, ...noTitle } = customLayout();
    void _t;
    expect(parseLayoutPayload(noTitle)).toBeNull();
  });

  // The panel caps the title at maxLength={200}, but that attribute is
  // bypassable; the server enforces the same bound so an oversized title can't
  // reach the JSONB column / the PDF. Pin the boundary: 200 is accepted, 201 is
  // rejected.
  it("accepts a document_title at the length cap and rejects one over it", () => {
    const atCap = parseLayoutPayload({
      ...customLayout(),
      document_title: "a".repeat(DOCUMENT_TITLE_MAX_LENGTH),
    });
    expect(atCap?.document_title).toHaveLength(DOCUMENT_TITLE_MAX_LENGTH);
    expect(
      parseLayoutPayload({
        ...customLayout(),
        document_title: "a".repeat(DOCUMENT_TITLE_MAX_LENGTH + 1),
      }),
    ).toBeNull();
  });

  it("strips unknown keys, returning only the canonical layout shape", () => {
    const payload = customLayout();
    const result = parseLayoutPayload({ ...payload, evil: "drop me", id: "x" });
    expect(result).toEqual(payload);
    expect(result).not.toHaveProperty("evil");
    expect(result).not.toHaveProperty("id");
  });
});
