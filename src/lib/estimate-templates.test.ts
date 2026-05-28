import { describe, expect, it } from "vitest";

import { serializeStructureFromBuilder, synthItemFromTemplate } from "./estimate-templates";
import type { TemplateStructureItem, TemplateWithContents } from "@/lib/types";

// Minimal builder-shape factory — only the fields the serializer reads matter.
function makeBuilderState(
  items: TemplateWithContents["sections"][number]["items"],
): TemplateWithContents {
  return {
    id: "tmpl-1",
    organization_id: "org-1",
    name: "T",
    description: null,
    damage_type_tags: [],
    opening_statement: null,
    closing_statement: null,
    structure: { sections: [] },
    is_active: true,
    created_by: null,
    created_at: "",
    updated_at: "",
    sections: [
      {
        id: "sec-1",
        title: "Demo",
        sort_order: 0,
        parent_section_id: null,
        items,
        subsections: [],
      },
    ],
  };
}

describe("serializeStructureFromBuilder (snapshot shape, #351)", () => {
  it("writes flat snapshot fields for a library-backed item", () => {
    const state = makeBuilderState([
      {
        id: "li-1",
        library_item_id: "lib-abc",
        name: "Asbestos Testing",
        description: "Lab analysis of sample",
        code: "ABT-01",
        quantity: 2,
        unit: "ea",
        unit_price: 125.5,
        sort_order: 0,
      },
    ]);

    const out = serializeStructureFromBuilder(state);
    const item = out.sections[0].items![0];

    expect(item).toMatchObject({
      library_item_id: "lib-abc",
      name: "Asbestos Testing",
      description: "Lab analysis of sample",
      code: "ABT-01",
      unit: "ea",
      quantity: 2,
      unit_price: 125.5,
      sort_order: 0,
    });
  });

  it("does NOT write legacy *_override fields", () => {
    const state = makeBuilderState([
      {
        id: "li-1",
        library_item_id: "lib-abc",
        name: "X",
        description: "d",
        code: null,
        quantity: 1,
        unit: null,
        unit_price: 0,
        sort_order: 0,
      },
    ]);

    const item = serializeStructureFromBuilder(state).sections[0].items![0];

    expect(item).not.toHaveProperty("description_override");
    expect(item).not.toHaveProperty("quantity_override");
    expect(item).not.toHaveProperty("unit_price_override");
  });

  it("writes flat snapshot fields for a custom item (null library_item_id)", () => {
    const state = makeBuilderState([
      {
        id: "li-1",
        library_item_id: null,
        name: "Custom one-off",
        description: "Hand-written line",
        code: "CUST-1",
        quantity: 3,
        unit: "hr",
        unit_price: 75,
        sort_order: 0,
      },
    ]);

    const item = serializeStructureFromBuilder(state).sections[0].items![0];

    expect(item).toMatchObject({
      library_item_id: null,
      name: "Custom one-off",
      description: "Hand-written line",
      code: "CUST-1",
      unit: "hr",
      quantity: 3,
      unit_price: 75,
    });
  });

  it("also writes the snapshot fields for subsection items", () => {
    const state: TemplateWithContents = {
      ...makeBuilderState([]),
      sections: [
        {
          id: "sec-1",
          title: "Demo",
          sort_order: 0,
          parent_section_id: null,
          items: [],
          subsections: [
            {
              id: "sub-1",
              title: "Sub",
              sort_order: 0,
              items: [
                {
                  id: "li-sub-1",
                  library_item_id: null,
                  name: "Sub Custom",
                  description: "Sub desc",
                  code: "SUB-1",
                  quantity: 5,
                  unit: "sqft",
                  unit_price: 12.25,
                  sort_order: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    const subItem = serializeStructureFromBuilder(state).sections[0].subsections![0].items![0];
    expect(subItem).toMatchObject({
      name: "Sub Custom",
      description: "Sub desc",
      code: "SUB-1",
      unit: "sqft",
      quantity: 5,
      unit_price: 12.25,
    });
  });
});

describe("synthItemFromTemplate (snapshot read + legacy fallback, #351)", () => {
  it("reads flat snapshot fields when present (new shape)", () => {
    const stored: TemplateStructureItem = {
      library_item_id: "lib-abc",
      name: "Asbestos Testing",
      description: "Lab analysis",
      code: "ABT-01",
      unit: "ea",
      quantity: 2,
      unit_price: 125.5,
      sort_order: 0,
    };

    const out = synthItemFromTemplate("sec-1", 0, stored);

    expect(out).toMatchObject({
      library_item_id: "lib-abc",
      name: "Asbestos Testing",
      description: "Lab analysis",
      code: "ABT-01",
      unit: "ea",
      quantity: 2,
      unit_price: 125.5,
      sort_order: 0,
    });
  });

  it("falls back to *_override fields on un-migrated rows (old shape)", () => {
    const legacy: TemplateStructureItem = {
      library_item_id: "lib-abc",
      description_override: "Legacy description",
      quantity_override: 7,
      unit_price_override: 42,
      sort_order: 0,
    };

    const out = synthItemFromTemplate("sec-1", 0, legacy);

    expect(out).toMatchObject({
      library_item_id: "lib-abc",
      description: "Legacy description",
      quantity: 7,
      unit_price: 42,
    });
    // name/code/unit on the legacy shape are unknown at the template layer
    // (they used to be resolved from the library at apply-time); the projection
    // surfaces null so the builder can render them blank rather than guess.
    expect(out.name).toBeNull();
    expect(out.code).toBeNull();
    expect(out.unit).toBeNull();
  });

  it("prefers flat fields over override fields when both are present", () => {
    const mixed: TemplateStructureItem = {
      library_item_id: null,
      name: "Flat name",
      description: "Flat desc",
      code: "FLAT",
      unit: "ea",
      quantity: 3,
      unit_price: 9,
      // Legacy values that must be ignored.
      description_override: "OLD desc",
      quantity_override: 99,
      unit_price_override: 99,
      sort_order: 0,
    };

    const out = synthItemFromTemplate("sec-1", 0, mixed);

    expect(out).toMatchObject({
      name: "Flat name",
      description: "Flat desc",
      code: "FLAT",
      unit: "ea",
      quantity: 3,
      unit_price: 9,
    });
  });
});
