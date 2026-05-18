import { describe, it, expect } from "vitest";
import type { OverlayField } from "./types";
import type { MergeFieldDefinition } from "./merge-field-registry";
import { rewriteOverlayNameFields } from "./template-name-rewrite";

function mergeField(id: string, slug: string, x = 0): OverlayField {
  return {
    id,
    type: "merge",
    page: 1,
    x,
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

function mapsTo(slug: string, column: string): MergeFieldDefinition {
  return { slug, label: slug, section: "Caller", source: { kind: "maps_to", column } };
}

// A registry where `customer_first_name` -> contact.first_name and
// `last_name` -> contact.last_name, matching the org-specific slugs seen
// in production form_configs.
const REGISTRY: MergeFieldDefinition[] = [
  mapsTo("customer_first_name", "contact.first_name"),
  mapsTo("last_name", "contact.last_name"),
  mapsTo("customer_phone", "contact.phone"),
];

describe("rewriteOverlayNameFields", () => {
  it("renames a first-name overlay merge field to customer_name", () => {
    const fields = [mergeField("a", "customer_first_name")];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out.map((f) => f.mergeFieldName)).toEqual(["customer_name"]);
  });

  it("drops the last-name overlay field when a first-name field is present (the gap case)", () => {
    const fields = [
      mergeField("a", "customer_first_name", 100),
      mergeField("b", "last_name", 220),
    ];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out.map((f) => f.id)).toEqual(["a"]);
    expect(out[0].mergeFieldName).toBe("customer_name");
  });

  it("renames a lone last-name overlay field to customer_name when no first-name field is present", () => {
    const fields = [mergeField("b", "last_name")];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out.map((f) => f.mergeFieldName)).toEqual(["customer_name"]);
  });

  it("leaves a template with neither name field unchanged", () => {
    const fields = [mergeField("a", "customer_phone"), signatureField("s")];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out).toEqual(fields);
  });

  it("leaves non-name merge fields and non-merge fields untouched", () => {
    const fields = [
      mergeField("a", "customer_first_name"),
      mergeField("p", "customer_phone"),
      signatureField("s"),
    ];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out.find((f) => f.id === "p")?.mergeFieldName).toBe("customer_phone");
    expect(out.find((f) => f.id === "s")).toEqual(signatureField("s"));
  });

  it("is idempotent — a template already using customer_name is unchanged", () => {
    const fields = [mergeField("a", "customer_name"), mergeField("p", "customer_phone")];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out).toEqual(fields);
  });

  it("renames every first-name field and drops every last-name field", () => {
    const fields = [
      mergeField("a", "customer_first_name"),
      mergeField("b", "last_name"),
      mergeField("c", "customer_first_name"),
      mergeField("d", "last_name"),
    ];
    const out = rewriteOverlayNameFields(fields, REGISTRY);
    expect(out.map((f) => f.id)).toEqual(["a", "c"]);
    expect(out.every((f) => f.mergeFieldName === "customer_name")).toBe(true);
  });

  it("identifies name fields by maps_to column, not by slug string", () => {
    // A registry whose name field carries an arbitrary slug — the rewrite
    // must still recognise it via its contact.first_name mapping.
    const registry: MergeFieldDefinition[] = [
      mapsTo("caller_given_name", "contact.first_name"),
    ];
    const fields = [mergeField("a", "caller_given_name")];
    const out = rewriteOverlayNameFields(fields, registry);
    expect(out[0].mergeFieldName).toBe("customer_name");
  });

  it("returns a new array and does not mutate the input", () => {
    const fields = [mergeField("a", "customer_first_name")];
    const snapshot = JSON.parse(JSON.stringify(fields));
    rewriteOverlayNameFields(fields, REGISTRY);
    expect(fields).toEqual(snapshot);
  });
});
