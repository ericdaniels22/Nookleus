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
        note: null,
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

  it("writes flat snapshot fields for a custom item (null library_item_id)", () => {
    const state = makeBuilderState([
      {
        id: "li-1",
        library_item_id: null,
        name: "Custom one-off",
        description: "Hand-written line",
        note: null,
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

  it("writes the note snapshot field (#382)", () => {
    const state = makeBuilderState([
      {
        id: "li-1",
        library_item_id: null,
        name: "Antimicrobial",
        description: "Apply to affected framing",
        note: "Use low-VOC product per homeowner request",
        code: null,
        quantity: 1,
        unit: null,
        unit_price: 10,
        sort_order: 0,
      },
    ]);

    const item = serializeStructureFromBuilder(state).sections[0].items![0];
    expect(item.note).toBe("Use low-VOC product per homeowner request");
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
                  note: null,
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

describe("synthItemFromTemplate (snapshot read, #351/#353)", () => {
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

  it("reads the note snapshot field when present (#382)", () => {
    const stored: TemplateStructureItem = {
      library_item_id: null,
      name: "Antimicrobial",
      description: "Apply to affected framing",
      note: "Use low-VOC product per homeowner request",
      sort_order: 0,
    };

    const out = synthItemFromTemplate("sec-1", 0, stored);
    expect(out.note).toBe("Use low-VOC product per homeowner request");
  });

  it("surfaces a null note when the snapshot omits it (#382)", () => {
    const bare: TemplateStructureItem = { library_item_id: "lib-abc", sort_order: 0 };

    const out = synthItemFromTemplate("sec-1", 0, bare);
    expect(out.note).toBeNull();
  });

  it("falls back to blanks/defaults when the snapshot fields are absent", () => {
    // A bare item (only a breadcrumb + sort order). With no library lookup and
    // no override fallback (#353), the projection surfaces null name/code/unit
    // and the builder-friendly empty/1/0 floors for description/qty/price.
    const bare: TemplateStructureItem = {
      library_item_id: "lib-abc",
      sort_order: 0,
    };

    const out = synthItemFromTemplate("sec-1", 0, bare);

    expect(out.name).toBeNull();
    expect(out.code).toBeNull();
    expect(out.unit).toBeNull();
    expect(out.description).toBe("");
    expect(out.quantity).toBe(1);
    expect(out.unit_price).toBe(0);
    expect(out.library_item_id).toBe("lib-abc");
  });
});
