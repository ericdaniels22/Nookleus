import { describe, it, expect } from "vitest";
import { validateOverlayFields } from "./overlay-validation";
import type { OverlayField, PdfPage } from "./types";

const PAGES: PdfPage[] = [{ page: 1, width_pt: 612, height_pt: 792 }];

function baseCheckbox(over: Partial<OverlayField> = {}): OverlayField {
  return {
    id: "c1",
    type: "checkbox",
    page: 1,
    x: 0,
    y: 0,
    width: 12,
    height: 12,
    fontSize: 11,
    inputKey: "auto_x",
    ...over,
  };
}

describe("validateOverlayFields — auto-fill checkbox binding", () => {
  it("accepts a well-formed binding to a known merge field", () => {
    const fields = [
      baseCheckbox({
        autoFillBinding: {
          mergeFieldName: "property_type",
          matchValues: ["single_family"],
        },
      }),
    ];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set(["property_type"]));
    expect(errs).toEqual([]);
  });

  it("rejects a binding whose merge field is not in the registry", () => {
    const fields = [
      baseCheckbox({
        autoFillBinding: {
          mergeFieldName: "nope_not_here",
          matchValues: ["single_family"],
        },
      }),
    ];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set(["property_type"]));
    expect(errs).toEqual([
      {
        fieldId: "c1",
        code: "unknown_autofill_merge_field",
        message: "Auto-fill checkbox references unknown merge field: nope_not_here",
      },
    ]);
  });

  it("rejects a binding with empty matchValues", () => {
    const fields = [
      baseCheckbox({
        autoFillBinding: { mergeFieldName: "property_type", matchValues: [] },
      }),
    ];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set(["property_type"]));
    expect(errs).toEqual([
      {
        fieldId: "c1",
        code: "empty_autofill_match_values",
        message: "Auto-fill checkbox requires a non-empty matchValues array of strings",
      },
    ]);
  });

  it("rejects a binding with non-string entries in matchValues", () => {
    const fields = [
      baseCheckbox({
        autoFillBinding: {
          mergeFieldName: "property_type",
          // simulate bad client payload
          matchValues: ["single_family", 42 as unknown as string],
        },
      }),
    ];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set(["property_type"]));
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("empty_autofill_match_values");
  });

  it("allows checkboxes without autoFillBinding to pass through unchanged (customer-ticks-at-signing)", () => {
    const fields = [baseCheckbox({ inputKey: "agreed_to_terms" })];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set());
    expect(errs).toEqual([]);
  });

  it("does NOT apply binding checks to input fields even if autoFillBinding shape exists on them", () => {
    // Auto-fill is a checkbox-only concept; input fields with the property
    // (shouldn't happen from the UI) are ignored by the validator.
    const fields: OverlayField[] = [
      {
        id: "i1",
        type: "input",
        page: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 16,
        fontSize: 11,
        inputKey: "deductible",
      },
    ];
    const errs = validateOverlayFields(fields, PAGES, 1, new Set());
    expect(errs).toEqual([]);
  });
});
