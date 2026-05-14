import { describe, it, expect } from "vitest";
import { evaluateAutoCheckboxes } from "./auto-checkbox-evaluator";
import type { OverlayField } from "./types";

function checkbox(
  id: string,
  inputKey: string,
  binding?: { mergeFieldName: string; matchValues: string[] },
): OverlayField {
  return {
    id,
    type: "checkbox",
    page: 1,
    x: 0,
    y: 0,
    width: 12,
    height: 12,
    fontSize: 11,
    inputKey,
    ...(binding ? { autoFillBinding: binding } : {}),
  };
}

describe("evaluateAutoCheckboxes", () => {
  it("ticks when resolved value is in matchValues", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "single_family" });
    expect(result.inputs).toEqual({ is_residential: true });
    expect(result.unresolved).toEqual([]);
  });

  it("does not tick when resolved value is not in matchValues", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "commercial" });
    expect(result.inputs).toEqual({ is_residential: false });
    expect(result.unresolved).toEqual([]);
  });

  it("flags unresolved when resolved value is null", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: null });
    expect(result.inputs).toEqual({ is_residential: false });
    expect(result.unresolved).toEqual(["is_residential"]);
  });

  it("flags unresolved when the merge field is missing from the resolved map", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, {});
    expect(result.inputs).toEqual({ is_residential: false });
    expect(result.unresolved).toEqual(["is_residential"]);
  });

  it("flags unresolved when the resolved value is an empty string", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "" });
    expect(result.inputs).toEqual({ is_residential: false });
    expect(result.unresolved).toEqual(["is_residential"]);
  });

  it("ticks on a multi-value list when any one value matches", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family", "multi_family", "condo"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "condo" });
    expect(result.inputs).toEqual({ is_residential: true });
    expect(result.unresolved).toEqual([]);
  });

  it("skips checkboxes without an autoFillBinding (customer-ticks-at-signing)", () => {
    const fields = [checkbox("a", "agreed_to_terms")];
    const result = evaluateAutoCheckboxes(fields, { property_type: "single_family" });
    expect(result.inputs).toEqual({});
    expect(result.unresolved).toEqual([]);
  });

  it("ignores non-checkbox overlay fields", () => {
    const fields: OverlayField[] = [
      {
        id: "m",
        type: "merge",
        page: 1,
        x: 0,
        y: 0,
        width: 100,
        height: 12,
        fontSize: 11,
        mergeFieldName: "property_type",
      },
      checkbox("c", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "single_family" });
    expect(result.inputs).toEqual({ is_residential: true });
    expect(result.unresolved).toEqual([]);
  });

  it("skips bound checkboxes without an inputKey (defensive)", () => {
    const fields: OverlayField[] = [
      {
        id: "broken",
        type: "checkbox",
        page: 1,
        x: 0,
        y: 0,
        width: 12,
        height: 12,
        fontSize: 11,
        autoFillBinding: { mergeFieldName: "property_type", matchValues: ["x"] },
      },
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "x" });
    expect(result.inputs).toEqual({});
    expect(result.unresolved).toEqual([]);
  });

  it("supports the mutex pattern: disjoint bindings produce exactly one tick", () => {
    const fields = [
      checkbox("r", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: ["single_family", "multi_family", "condo"],
      }),
      checkbox("c", "is_commercial", {
        mergeFieldName: "property_type",
        matchValues: ["office", "retail", "warehouse"],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "condo" });
    expect(result.inputs).toEqual({ is_residential: true, is_commercial: false });
    expect(result.unresolved).toEqual([]);
  });

  it("treats an empty matchValues array as never-ticked (defensive against bad data)", () => {
    const fields = [
      checkbox("a", "is_residential", {
        mergeFieldName: "property_type",
        matchValues: [],
      }),
    ];
    const result = evaluateAutoCheckboxes(fields, { property_type: "single_family" });
    expect(result.inputs).toEqual({ is_residential: false });
    expect(result.unresolved).toEqual([]);
  });
});
