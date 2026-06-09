// GroupedLineItemTable (#573) — one continuous grouped table replacing the
// per-section card stack. Sections and subsections render as header rows
// inside a single list; line items are select-only rows; numbering comes from
// the positional-numbering module (#568).
//
// Tests exercise the component's public interface only (props in, DOM +
// callbacks out). dnd-kit needs an ancestor DndContext, which the real
// EstimateBuilder provides — the harness wraps with a bare one.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import {
  GroupedLineItemTable,
  type GroupedSection,
} from "./grouped-line-item-table";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Structurally complete for everything the table reads (id / title /
// sort_order / parent_section_id / items / subsections, items with the
// LineItemRow display fields). Cast like estimate-builder's template branch.

function makeItem(
  id: string,
  sectionId: string,
  name: string,
  sortOrder = 0,
): GroupedSection["items"][number] {
  return {
    id,
    section_id: sectionId,
    name,
    description: `${name} description`,
    note: null,
    code: null,
    // 7, not 1 — keeps the rendered quantity from colliding with positional
    // numbers ("1", "2") in exact-text queries.
    quantity: 7,
    unit: null,
    unit_price: 100,
    sort_order: sortOrder,
  } as unknown as GroupedSection["items"][number];
}

function fixtureSections(): GroupedSection[] {
  return [
    {
      id: "S1",
      parent_section_id: null,
      title: "Roof",
      sort_order: 0,
      items: [makeItem("A", "S1", "Tear-off")],
      subsections: [
        {
          id: "Sub1",
          parent_section_id: "S1",
          title: "Flashing",
          sort_order: 0,
          items: [makeItem("X", "Sub1", "Step flashing")],
        },
      ],
    },
    {
      id: "S2",
      parent_section_id: null,
      title: "Gutters",
      sort_order: 1,
      items: [],
      subsections: [],
    },
  ] as unknown as GroupedSection[];
}

function renderTable(
  overrides: Partial<React.ComponentProps<typeof GroupedLineItemTable>> = {},
) {
  return render(
    <DndContext>
      <GroupedLineItemTable sections={fixtureSections()} {...overrides} />
    </DndContext>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GroupedLineItemTable", () => {
  it("renders sections, subsections, and line items as one continuous grouped list with positional numbers", () => {
    renderTable();

    // Everything lives inside ONE table container — not separate cards.
    const table = screen.getByTestId("grouped-line-item-table");
    expect(within(table).getByText("Roof")).toBeDefined();
    expect(within(table).getByText("Flashing")).toBeDefined();
    expect(within(table).getByText("Step flashing")).toBeDefined();
    expect(within(table).getByText("Tear-off")).toBeDefined();
    expect(within(table).getByText("Gutters")).toBeDefined();

    // Positional numbers from the numbering module on every header and row:
    // sections 1/2, subsection 1.1, its item 1.1.1, then the direct item
    // continues the shared second-level counter at 1.2.
    expect(within(table).getByText("1")).toBeDefined();
    expect(within(table).getByText("1.1")).toBeDefined();
    expect(within(table).getByText("1.1.1")).toBeDefined();
    expect(within(table).getByText("1.2")).toBeDefined();
    expect(within(table).getByText("2")).toBeDefined();
  });

  it("shows an entry count on every section and subsection header", () => {
    renderTable();
    const table = screen.getByTestId("grouped-line-item-table");

    // Roof holds 2 items in total (1 direct + 1 inside Flashing); Flashing
    // holds 1; empty Gutters shows a zero count rather than hiding the pill.
    expect(within(table).getByText("2 items")).toBeDefined();
    expect(within(table).getByText("1 item")).toBeDefined();
    expect(within(table).getByText("0 items")).toBeDefined();
  });

  it("collapses and expands a section, hiding its subsection and item rows", () => {
    renderTable();

    const roof = screen.getByText("Roof").closest("li") as HTMLElement;
    fireEvent.click(
      within(roof).getByRole("button", { name: /collapse section/i }),
    );

    // All of Roof's contents are hidden — subsection header included.
    expect(screen.queryByText("Tear-off")).toBeNull();
    expect(screen.queryByText("Flashing")).toBeNull();
    expect(screen.queryByText("Step flashing")).toBeNull();
    // The header row itself stays, as do other sections.
    expect(screen.getByText("Roof")).toBeDefined();
    expect(screen.getByText("Gutters")).toBeDefined();

    fireEvent.click(
      within(roof).getByRole("button", { name: /expand section/i }),
    );
    expect(screen.getByText("Tear-off")).toBeDefined();
    expect(screen.getByText("Step flashing")).toBeDefined();
  });

  it("collapses a subsection without touching the section's direct items", () => {
    renderTable();

    const flashing = screen.getByText("Flashing").closest("li") as HTMLElement;
    fireEvent.click(
      within(flashing).getByRole("button", { name: /collapse subsection/i }),
    );

    expect(screen.queryByText("Step flashing")).toBeNull();
    // Header survives; the sibling direct item is untouched.
    expect(screen.getByText("Flashing")).toBeDefined();
    expect(screen.getByText("Tear-off")).toBeDefined();

    fireEvent.click(
      within(flashing).getByRole("button", { name: /expand subsection/i }),
    );
    expect(screen.getByText("Step flashing")).toBeDefined();
  });

  it("collapses and expands everything via the Collapse all toggle", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));

    // Every section's contents hide; headers stay.
    expect(screen.queryByText("Tear-off")).toBeNull();
    expect(screen.queryByText("Flashing")).toBeNull();
    expect(screen.queryByText("Step flashing")).toBeNull();
    expect(screen.getByText("Roof")).toBeDefined();
    expect(screen.getByText("Gutters")).toBeDefined();

    // The toggle flips to Expand all, which restores the full tree —
    // subsection contents included.
    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(screen.getByText("Tear-off")).toBeDefined();
    expect(screen.getByText("Flashing")).toBeDefined();
    expect(screen.getByText("Step flashing")).toBeDefined();
  });

  it("marks the selected row and reports row clicks (select-only editing)", () => {
    const onSelectLineItem = vi.fn();
    renderTable({ selectedLineItemId: "A", onSelectLineItem });

    const rows = screen.getAllByTestId("line-item-row");
    const tearOff = rows.find((row) => within(row).queryByText("Tear-off"));
    const stepFlashing = rows.find((row) =>
      within(row).queryByText("Step flashing"),
    );
    expect(tearOff?.getAttribute("data-selected")).toBe("true");
    expect(stepFlashing?.getAttribute("data-selected")).toBeFalsy();

    fireEvent.click(screen.getByText("Step flashing"));
    expect(onSelectLineItem).toHaveBeenCalledWith("X");
  });

  it("gives every line-item row a checkbox that toggles without selecting the row", () => {
    const onSelectLineItem = vi.fn();
    renderTable({ onSelectLineItem });

    const rows = screen.getAllByTestId("line-item-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByRole("checkbox")).toBeDefined();
    }

    const tearOff = rows.find((row) =>
      within(row).queryByText("Tear-off"),
    ) as HTMLElement;
    const checkbox = within(tearOff).getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    // Checking is an affordance of its own — it must not open the editor.
    expect(onSelectLineItem).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("puts a drag handle on every section header, subsection header, and item row", () => {
    renderTable();

    // Header handles reuse the card-era accessible names so the existing
    // drag-end suites keep finding them. String names match exactly, so
    // "Drag to reorder" does not swallow the section/subsection variants.
    expect(
      screen.getAllByRole("button", { name: "Drag section to reorder" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Drag subsection to reorder" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Drag to reorder" }),
    ).toHaveLength(2);
  });

  it("offers From price list and New item under one + Add control, targeting the last section", async () => {
    const onAddLineItem = vi.fn();
    renderTable({ onAddLineItem });

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /from price list/i }),
    );
    // New entries land in the LAST section — the predictable end of the document.
    expect(onAddLineItem).toHaveBeenCalledWith("S2", "library");

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /new item/i }));
    expect(onAddLineItem).toHaveBeenCalledWith("S2", "custom");
  });

  it("adds a section inline via + Add → New section", async () => {
    const onAddSection = vi.fn();
    renderTable({ onAddSection });

    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /new section/i }),
    );

    const input = screen.getByPlaceholderText("Section name");
    fireEvent.change(input, { target: { value: "Skylights" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAddSection).toHaveBeenCalledWith("Skylights");
    // The inline input closes once the title is handed off.
    expect(screen.queryByPlaceholderText("Section name")).toBeNull();
  });

  it("shows distinct empty placeholders for empty subsections and empty sections", () => {
    const sections = fixtureSections();
    // S2 gains an empty subsection; S3 is a completely empty section.
    sections[1] = {
      ...sections[1],
      subsections: [
        {
          id: "Sub2",
          parent_section_id: "S2",
          title: "Downspouts",
          sort_order: 0,
          items: [],
        },
      ],
    } as unknown as GroupedSection;
    sections.push({
      id: "S3",
      parent_section_id: null,
      title: "Siding",
      sort_order: 2,
      items: [],
      subsections: [],
    } as unknown as GroupedSection);
    renderTable({ sections });

    // Subsection copy is EXACTLY the card-era string (the drag-end suites
    // getByText it, so it must stay unique — the section copy must differ).
    expect(screen.getByText("No items yet.")).toBeDefined();
    expect(screen.getByText("No items in this section yet.")).toBeDefined();
  });

  it("reports row deletes via onDeleteLineItem without selecting the row", () => {
    const onDeleteLineItem = vi.fn();
    const onSelectLineItem = vi.fn();
    renderTable({ onDeleteLineItem, onSelectLineItem });

    const rows = screen.getAllByTestId("line-item-row");
    const tearOff = rows.find((row) =>
      within(row).queryByText("Tear-off"),
    ) as HTMLElement;
    fireEvent.click(
      within(tearOff).getByRole("button", { name: /delete line item/i }),
    );

    expect(onDeleteLineItem).toHaveBeenCalledWith("A");
    expect(onSelectLineItem).not.toHaveBeenCalled();
  });

  it("renames a section inline via the kebab's Rename", async () => {
    const onRenameSection = vi.fn();
    renderTable({ onRenameSection });

    const roof = screen.getByText("Roof").closest("li") as HTMLElement;
    // Exact name — "Section actions" must not match the subsection kebab
    // ("Subsection actions") that also lives inside Roof's li.
    fireEvent.click(
      within(roof).getByRole("button", { name: "Section actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /rename/i }));

    const input = screen.getByDisplayValue("Roof");
    fireEvent.change(input, { target: { value: "Roofing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameSection).toHaveBeenCalledWith("S1", "Roofing");
    // The inline input closes after the commit.
    expect(screen.queryByDisplayValue("Roofing")).toBeNull();
  });

  it("adds a subsection via the section kebab's Add subsection dialog", async () => {
    const onAddSubsection = vi.fn();
    renderTable({ onAddSubsection });

    const gutters = screen.getByText("Gutters").closest("li") as HTMLElement;
    fireEvent.click(
      within(gutters).getByRole("button", { name: "Section actions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /add subsection/i }),
    );

    const input = screen.getByPlaceholderText("Subsection name");
    fireEvent.change(input, { target: { value: "Downspouts" } });
    fireEvent.click(screen.getByRole("button", { name: "Add subsection" }));

    expect(onAddSubsection).toHaveBeenCalledWith("S2", "Downspouts");
  });

  it("deletes a section via the kebab's Delete confirmation dialog", async () => {
    const onDeleteSection = vi.fn();
    renderTable({ onDeleteSection });

    const roof = screen.getByText("Roof").closest("li") as HTMLElement;
    fireEvent.click(
      within(roof).getByRole("button", { name: "Section actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // The confirmation dialog spells out what's inside before deleting:
    // Roof holds 1 direct item + 1 item inside its 1 subsection → "2 items
    // across 1 subsection".
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete section?")).toBeDefined();
    expect(within(dialog).getByText("2")).toBeDefined();
    expect(within(dialog).getByText("1")).toBeDefined();
    expect(onDeleteSection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDeleteSection).toHaveBeenCalledWith("S1");
  });

  it("renames a subsection inline via the kebab's Rename", async () => {
    const onRenameSubsection = vi.fn();
    renderTable({ onRenameSubsection });

    // closest("li") of the subsection title is the subsection's own li,
    // nested inside Roof's section li.
    const flashing = screen.getByText("Flashing").closest("li") as HTMLElement;
    fireEvent.click(
      within(flashing).getByRole("button", { name: "Subsection actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /rename/i }));

    const input = screen.getByDisplayValue("Flashing");
    fireEvent.change(input, { target: { value: "Counter flashing" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameSubsection).toHaveBeenCalledWith("Sub1", "Counter flashing");
    // The inline input closes after the commit.
    expect(screen.queryByDisplayValue("Counter flashing")).toBeNull();
  });

  it("deletes a subsection via the kebab's Delete confirmation dialog", async () => {
    const onDeleteSubsection = vi.fn();
    renderTable({ onDeleteSubsection });

    const flashing = screen.getByText("Flashing").closest("li") as HTMLElement;
    fireEvent.click(
      within(flashing).getByRole("button", { name: "Subsection actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // The confirmation dialog names the subsection and its item count
    // (Flashing holds 1 item) before anything is deleted.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete subsection?")).toBeDefined();
    expect(within(dialog).getByText("1")).toBeDefined();
    expect(onDeleteSubsection).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDeleteSubsection).toHaveBeenCalledWith("Sub1");
  });

  it("readOnly hides every editing affordance but keeps collapse", () => {
    renderTable({
      readOnly: true,
      onSelectLineItem: vi.fn(),
      onDeleteLineItem: vi.fn(),
      onAddLineItem: vi.fn(),
      onAddSection: vi.fn(),
      onRenameSection: vi.fn(),
      onAddSubsection: vi.fn(),
      onDeleteSection: vi.fn(),
      onRenameSubsection: vi.fn(),
      onDeleteSubsection: vi.fn(),
    });

    // Drag handles (section / subsection / row), kebabs, "+ Add", row
    // checkboxes, and row deletes all disappear...
    expect(screen.queryByRole("button", { name: /drag/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Section actions" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Subsection actions" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /delete line item/i }),
    ).toBeNull();

    // ...but collapsing stays available.
    fireEvent.click(
      screen.getAllByRole("button", { name: /collapse section/i })[0],
    );
    expect(
      screen.getByRole("button", { name: /expand section/i }),
    ).toBeDefined();
  });
});
