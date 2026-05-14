import { describe, it, expect } from "vitest";
import type { FormConfig } from "@/lib/types";
import { buildMergeFieldRegistry } from "./merge-field-registry";

describe("buildMergeFieldRegistry", () => {
  it("creates one entry for a single visible text field with maps_to", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            {
              id: "first_name",
              type: "text",
              label: "First Name",
              visible: true,
              maps_to: "contact.first_name",
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry).toEqual([
      {
        slug: "first_name",
        label: "First Name",
        section: "Caller Information",
        source: { kind: "maps_to", column: "contact.first_name" },
      },
    ]);
  });

  it("appends system fields after intake-derived fields", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            {
              id: "first_name",
              type: "text",
              label: "First Name",
              visible: true,
              maps_to: "contact.first_name",
            },
          ],
        },
      ],
    };
    const systemFields = [
      {
        slug: "date_today",
        label: "Today's Date",
        section: "System",
        source: { kind: "system" as const, key: "date_today" },
      },
      {
        slug: "company_name",
        label: "Company Name",
        section: "System",
        source: { kind: "system" as const, key: "company_name" },
      },
    ];

    const registry = buildMergeFieldRegistry(formConfig, systemFields);

    expect(registry.map((r) => r.slug)).toEqual([
      "first_name",
      "date_today",
      "company_name",
    ]);
  });

  it("preserves section grouping across multiple sections", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            { id: "first_name", type: "text", label: "First Name", visible: true, maps_to: "contact.first_name" },
          ],
        },
        {
          id: "property_info",
          title: "Property Information",
          visible: true,
          fields: [
            { id: "property_address", type: "text", label: "Property Address", visible: true, maps_to: "job.property_address" },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry.map((r) => ({ slug: r.slug, section: r.section }))).toEqual([
      { slug: "first_name", section: "Caller Information" },
      { slug: "property_address", section: "Property Information" },
    ]);
  });

  it("returns only system fields when form_config has no visible fields", () => {
    const formConfig: FormConfig = { sections: [] };
    const systemFields = [
      { slug: "date_today", label: "Today's Date", section: "System", source: { kind: "system" as const, key: "date_today" } },
    ];

    const registry = buildMergeFieldRegistry(formConfig, systemFields);

    expect(registry).toEqual(systemFields);
  });

  it("uses job_custom_fields source when the field has no maps_to", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            {
              id: "spouse_name",
              type: "text",
              label: "Spouse Name",
              visible: true,
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry[0].source).toEqual({
      kind: "job_custom_fields",
      field_key: "spouse_name",
    });
  });

  it("keeps fields where visible is false but marks them hidden", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            {
              id: "first_name",
              type: "text",
              label: "First Name",
              visible: true,
              maps_to: "contact.first_name",
            },
            {
              id: "middle_name",
              type: "text",
              label: "Middle Name",
              visible: false,
              maps_to: "contact.middle_name",
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry.map((r) => ({ slug: r.slug, hidden: r.hidden ?? false }))).toEqual([
      { slug: "first_name", hidden: false },
      { slug: "middle_name", hidden: true },
    ]);
  });

  it("marks fields in hidden sections as hidden but keeps them in the registry", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "hidden_section",
          title: "Hidden",
          visible: false,
          fields: [
            {
              id: "secret",
              type: "text",
              label: "Secret",
              visible: true,
              maps_to: "job.secret",
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry).toEqual([
      {
        slug: "secret",
        label: "Secret",
        section: "Hidden",
        source: { kind: "maps_to", column: "job.secret" },
        hidden: true,
      },
    ]);
  });

  it("carries pill options through with their labels", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "property_info",
          title: "Property Information",
          visible: true,
          fields: [
            {
              id: "property_type",
              type: "pill",
              label: "Property Type",
              visible: true,
              maps_to: "job.property_type",
              options: [
                { value: "single_family", label: "Single Family" },
                { value: "multi_family", label: "Multi Family" },
                { value: "commercial", label: "Commercial" },
              ],
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry[0].options).toEqual([
      { value: "single_family", label: "Single Family" },
      { value: "multi_family", label: "Multi Family" },
      { value: "commercial", label: "Commercial" },
    ]);
  });

  it("prefers merge_field_slug over id when both are set (legacy slug aliasing)", () => {
    const formConfig: FormConfig = {
      sections: [
        {
          id: "caller_info",
          title: "Caller Information",
          visible: true,
          fields: [
            {
              id: "first_name",
              type: "text",
              label: "First Name",
              visible: true,
              maps_to: "contact.first_name",
              merge_field_slug: "customer_first_name",
            },
          ],
        },
      ],
    };

    const registry = buildMergeFieldRegistry(formConfig, []);

    expect(registry[0].slug).toBe("customer_first_name");
  });
});
