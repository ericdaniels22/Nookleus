import { describe, it, expect } from "vitest";
import type { FormConfig } from "@/lib/types";
import { diffRemovedFields, fieldSlug } from "./form-config-removal-guard";

function cfg(fields: { id: string; merge_field_slug?: string }[]): FormConfig {
  return {
    sections: [
      {
        id: "s1",
        title: "S",
        visible: true,
        fields: fields.map((f) => ({
          id: f.id,
          type: "text",
          label: f.id,
          visible: true,
          ...(f.merge_field_slug ? { merge_field_slug: f.merge_field_slug } : {}),
        })),
      },
    ],
  };
}

describe("diffRemovedFields", () => {
  it("returns empty when prior is null (first save)", () => {
    expect(diffRemovedFields(null, cfg([{ id: "a" }]))).toEqual([]);
  });

  it("returns fields whose ids are not in next config", () => {
    const prior = cfg([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const next = cfg([{ id: "a" }, { id: "c" }]);
    const removed = diffRemovedFields(prior, next);
    expect(removed.map((f) => f.id)).toEqual(["b"]);
  });

  it("returns empty when next is a superset (pure additions)", () => {
    const prior = cfg([{ id: "a" }]);
    const next = cfg([{ id: "a" }, { id: "b" }]);
    expect(diffRemovedFields(prior, next)).toEqual([]);
  });

  it("detects removal across sections", () => {
    const prior: FormConfig = {
      sections: [
        {
          id: "s1",
          title: "S1",
          visible: true,
          fields: [{ id: "a", type: "text", label: "A", visible: true }],
        },
        {
          id: "s2",
          title: "S2",
          visible: true,
          fields: [{ id: "b", type: "text", label: "B", visible: true }],
        },
      ],
    };
    const next: FormConfig = {
      sections: [
        {
          id: "s1",
          title: "S1",
          visible: true,
          fields: [{ id: "a", type: "text", label: "A", visible: true }],
        },
      ],
    };
    expect(diffRemovedFields(prior, next).map((f) => f.id)).toEqual(["b"]);
  });
});

describe("fieldSlug", () => {
  it("returns merge_field_slug when set", () => {
    expect(
      fieldSlug({
        id: "first_name",
        type: "text",
        label: "First",
        merge_field_slug: "customer_first_name",
      }),
    ).toBe("customer_first_name");
  });

  it("falls back to id when merge_field_slug is unset", () => {
    expect(fieldSlug({ id: "first_name", type: "text", label: "First" })).toBe(
      "first_name",
    );
  });
});
