// Focused coverage for the LineItemRow note field (#382). Mounts the row inside
// real dnd-kit providers (LineItemRow calls useSortable) and exercises the
// inline note input: it seeds from item.note and commits on blur via onChange.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import { LineItemRow, type BuilderLineItem, type LineItemRowProps } from "./line-item-row";
import type { EstimateLineItem } from "@/lib/types";

const baseItem: EstimateLineItem = {
  id: "li-1",
  organization_id: "org-1",
  estimate_id: "est-1",
  section_id: "sec-1",
  library_item_id: null,
  name: "Antimicrobial",
  description: "Apply to affected framing",
  note: null,
  code: null,
  quantity: 1,
  unit: null,
  unit_price: 10,
  total: 10,
  pricing_mode: "standard",
  pieces: null,
  days: null,
  sketch_source: null,
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

function renderRow(
  item: EstimateLineItem,
  onChange: (n: Partial<BuilderLineItem>) => void,
  extra: Partial<LineItemRowProps> = {},
) {
  return render(
    <DndContext>
      <SortableContext items={[item.id]}>
        <LineItemRow
          item={item}
          parentSectionId="sec-1"
          onChange={onChange}
          onDelete={() => {}}
          {...extra}
        />
      </SortableContext>
    </DndContext>,
  );
}

describe("LineItemRow — note display (#546, supersedes #382)", () => {
  it("renders the note as static text when the item has one", () => {
    renderRow({ ...baseItem, note: "Use low-VOC primer" }, vi.fn());
    expect(screen.getByText("Use low-VOC primer")).toBeDefined();
  });

  it("no longer renders an editable note input", () => {
    renderRow({ ...baseItem, note: "Use low-VOC primer" }, vi.fn());
    expect(screen.queryByPlaceholderText("Note (optional)")).toBeNull();
  });

  it("omits the note line entirely when the item has no note", () => {
    renderRow({ ...baseItem, note: null }, vi.fn());
    // No placeholder, and no stray empty note text node to mistake for a field.
    expect(screen.queryByPlaceholderText("Note (optional)")).toBeNull();
  });

  it("never commits a note edit — the row no longer calls onChange", () => {
    const onChange = vi.fn();
    renderRow({ ...baseItem, note: "Keep me" }, onChange);
    // The note is display-only now: there is nothing to type into or blur.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("LineItemRow — read-only display (#546)", () => {
  it("renders the item name as static text, not an inline input", () => {
    renderRow({ ...baseItem, name: "Antimicrobial" }, vi.fn());
    // The editable name input is gone …
    expect(screen.queryByPlaceholderText("Item name")).toBeNull();
    // … the name now renders as plain text.
    expect(screen.getByText("Antimicrobial")).toBeDefined();
  });

  it("renders description, code, quantity, and unit as static text, not inputs", () => {
    renderRow(
      { ...baseItem, description: "Apply to affected framing", code: "AM-1", quantity: 3, unit: "ea" },
      vi.fn(),
    );
    // The editable inputs are gone …
    expect(screen.queryByPlaceholderText("Description")).toBeNull();
    expect(screen.queryByPlaceholderText("Code")).toBeNull();
    expect(screen.queryByPlaceholderText("Qty")).toBeNull();
    expect(screen.queryByPlaceholderText("Unit")).toBeNull();
    // … each value now renders as plain text.
    expect(screen.getByText("Apply to affected framing")).toBeDefined();
    expect(screen.getByText("AM-1")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("ea")).toBeDefined();
  });
});

describe("LineItemRow — static price & total (#546, supersedes #542)", () => {
  it("renders the unit price as static currency, not an editable MoneyInput", () => {
    // qty 2 keeps the unit-price value ($42.50) distinct from the total ($85.00).
    renderRow({ ...baseItem, quantity: 2, unit_price: 42.5 }, vi.fn());
    expect(screen.queryByPlaceholderText("0.00")).toBeNull();
    expect(screen.getByText("$42.50")).toBeDefined();
  });

  it("renders the line total as static currency derived from quantity × unit price", () => {
    renderRow({ ...baseItem, quantity: 2, unit_price: 10 }, vi.fn());
    expect(screen.getByText("$20.00")).toBeDefined();
  });

  it("updates the displayed total when the item prop changes (no local draft state)", () => {
    const { rerender } = renderRow({ ...baseItem, quantity: 3, unit_price: 10 }, vi.fn());
    expect(screen.getByText("$30.00")).toBeDefined();

    rerender(
      <DndContext>
        <SortableContext items={[baseItem.id]}>
          <LineItemRow
            item={{ ...baseItem, quantity: 3, unit_price: 20 }}
            parentSectionId="sec-1"
            onChange={vi.fn()}
            onDelete={() => {}}
          />
        </SortableContext>
      </DndContext>,
    );

    expect(screen.getByText("$60.00")).toBeDefined();
    expect(screen.queryByText("$30.00")).toBeNull();
  });
});

// Locks in criteria 1–4: the conversion removed every input, and the drag /
// select / delete affordances #544 introduced survive the rewrite unchanged.
describe("LineItemRow — select-only interactions (#546)", () => {
  it("renders no inline inputs at all — the row is display-only", () => {
    renderRow({ ...baseItem, code: "AM-1", unit: "ea", note: "Match existing color" }, vi.fn());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("selects the row when clicked (the only path to edit)", () => {
    const onSelect = vi.fn();
    renderRow(baseItem, vi.fn(), { onSelect });
    fireEvent.click(screen.getByTestId("line-item-row"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("highlights the row via data-selected when selected", () => {
    renderRow(baseItem, vi.fn(), { selected: true });
    expect(screen.getByTestId("line-item-row").getAttribute("data-selected")).toBe("true");
  });

  it("deletes directly from the row without first selecting it", () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    renderRow(baseItem, vi.fn(), { onDelete, onSelect });
    fireEvent.click(screen.getByLabelText("Delete line item"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps the drag handle for reordering", () => {
    renderRow(baseItem, vi.fn());
    expect(screen.getByLabelText("Drag to reorder")).toBeDefined();
  });
});
