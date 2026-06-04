// Focused coverage for the LineItemRow note field (#382). Mounts the row inside
// real dnd-kit providers (LineItemRow calls useSortable) and exercises the
// inline note input: it seeds from item.note and commits on blur via onChange.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

import { LineItemRow, type BuilderLineItem } from "./line-item-row";
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
  sort_order: 0,
  created_at: "",
  updated_at: "",
};

function renderRow(item: EstimateLineItem, onChange: (n: Partial<BuilderLineItem>) => void) {
  return render(
    <DndContext>
      <SortableContext items={[item.id]}>
        <LineItemRow item={item} parentSectionId="sec-1" onChange={onChange} onDelete={() => {}} />
      </SortableContext>
    </DndContext>,
  );
}

function noteInput(): HTMLInputElement {
  return screen.getByPlaceholderText("Note (optional)") as HTMLInputElement;
}

describe("LineItemRow — note field (#382)", () => {
  it("seeds the note input from item.note", () => {
    renderRow({ ...baseItem, note: "Use low-VOC primer" }, vi.fn());
    expect(noteInput().value).toBe("Use low-VOC primer");
  });

  it("commits the typed note on blur via onChange", () => {
    const onChange = vi.fn();
    renderRow(baseItem, onChange);

    fireEvent.change(noteInput(), { target: { value: "Match existing color" } });
    fireEvent.blur(noteInput());

    expect(onChange).toHaveBeenCalledWith({ note: "Match existing color" });
  });

  it("commits null when the note is cleared", () => {
    const onChange = vi.fn();
    renderRow({ ...baseItem, note: "stale" }, onChange);

    fireEvent.change(noteInput(), { target: { value: "   " } });
    fireEvent.blur(noteInput());

    expect(onChange).toHaveBeenCalledWith({ note: null });
  });

  it("does not fire onChange when the note is unchanged", () => {
    const onChange = vi.fn();
    renderRow({ ...baseItem, note: "Keep me" }, onChange);

    fireEvent.blur(noteInput());

    expect(onChange).not.toHaveBeenCalled();
  });
});
