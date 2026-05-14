import { describe, it, expect } from "vitest";
import type { OverlayField } from "./types";
import {
  extractReferencedSlugs,
  buildReferenceIndex,
  type TemplateRow,
} from "./template-reference-lookup";

function mergeField(id: string, slug: string): OverlayField {
  return {
    id,
    type: "merge",
    page: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    fontSize: 11,
    mergeFieldName: slug,
  };
}

function signatureField(id: string): OverlayField {
  return {
    id,
    type: "signature",
    page: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    fontSize: 11,
    signerOrder: 1,
  };
}

describe("extractReferencedSlugs", () => {
  it("returns slugs only for merge-type fields", () => {
    const fields: OverlayField[] = [
      mergeField("a", "customer_first_name"),
      signatureField("b"),
      mergeField("c", "property_address"),
    ];
    expect([...extractReferencedSlugs(fields)].sort()).toEqual([
      "customer_first_name",
      "property_address",
    ]);
  });

  it("dedupes repeated slugs within a single template", () => {
    const fields: OverlayField[] = [
      mergeField("a", "customer_first_name"),
      mergeField("b", "customer_first_name"),
    ];
    expect([...extractReferencedSlugs(fields)]).toEqual(["customer_first_name"]);
  });

  it("ignores merge fields with empty mergeFieldName", () => {
    const fields: OverlayField[] = [
      { ...mergeField("a", ""), mergeFieldName: "" },
    ];
    expect(extractReferencedSlugs(fields).size).toBe(0);
  });

  it("returns empty set for empty input", () => {
    expect(extractReferencedSlugs([]).size).toBe(0);
  });
});

describe("buildReferenceIndex", () => {
  it("maps each requested slug to templates that reference it", () => {
    const templates: TemplateRow[] = [
      {
        id: "t1",
        name: "Work Authorization",
        is_active: true,
        overlay_fields: [mergeField("a", "customer_first_name")],
      },
      {
        id: "t2",
        name: "Service Agreement",
        is_active: true,
        overlay_fields: [
          mergeField("a", "customer_first_name"),
          mergeField("b", "property_address"),
        ],
      },
      {
        id: "t3",
        name: "Old Template",
        is_active: false,
        overlay_fields: [mergeField("a", "claim_number")],
      },
    ];

    const idx = buildReferenceIndex(templates, [
      "customer_first_name",
      "property_address",
      "unused_slug",
    ]);

    expect(idx["customer_first_name"]).toEqual([
      { id: "t1", name: "Work Authorization", is_active: true },
      { id: "t2", name: "Service Agreement", is_active: true },
    ]);
    expect(idx["property_address"]).toEqual([
      { id: "t2", name: "Service Agreement", is_active: true },
    ]);
    expect(idx["unused_slug"]).toEqual([]);
  });

  it("returns is_active flag so UI can distinguish inactive templates", () => {
    const templates: TemplateRow[] = [
      {
        id: "t1",
        name: "Inactive Old",
        is_active: false,
        overlay_fields: [mergeField("a", "customer_first_name")],
      },
    ];
    const idx = buildReferenceIndex(templates, ["customer_first_name"]);
    expect(idx["customer_first_name"]).toEqual([
      { id: "t1", name: "Inactive Old", is_active: false },
    ]);
  });

  it("never lists the same template twice for one slug even when referenced multiple times", () => {
    const templates: TemplateRow[] = [
      {
        id: "t1",
        name: "Repeat",
        is_active: true,
        overlay_fields: [
          mergeField("a", "customer_first_name"),
          mergeField("b", "customer_first_name"),
        ],
      },
    ];
    const idx = buildReferenceIndex(templates, ["customer_first_name"]);
    expect(idx["customer_first_name"]).toHaveLength(1);
  });

  it("handles templates with null overlay_fields", () => {
    const templates: TemplateRow[] = [
      { id: "t1", name: "Empty", is_active: true, overlay_fields: null },
    ];
    const idx = buildReferenceIndex(templates, ["customer_first_name"]);
    expect(idx["customer_first_name"]).toEqual([]);
  });

  it("returns empty object when slugs list is empty (no work to do)", () => {
    const templates: TemplateRow[] = [
      {
        id: "t1",
        name: "Anything",
        is_active: true,
        overlay_fields: [mergeField("a", "customer_first_name")],
      },
    ];
    const idx = buildReferenceIndex(templates, []);
    expect(idx).toEqual({});
  });
});
