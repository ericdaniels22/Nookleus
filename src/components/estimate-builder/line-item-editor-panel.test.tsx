// Isolated component tests for LineItemEditorPanel (#544). The panel is the new
// editor surface for a selected line: seven fields, draft + commit-on-blur
// through the shared change pathway, a live line total, and a responsive shell
// (docked on desktop / slide-up sheet on phone). Builder wiring is covered
// separately in line-item-editor-panel.integration.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import React from "react";

import { LineItemEditorPanel } from "./line-item-editor-panel";
import type { EstimateLineItem } from "@/lib/types";

function makeItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: "A",
    organization_id: "org-1",
    estimate_id: "est-1",
    section_id: "S1",
    library_item_id: null,
    name: "Tear-off",
    description: "Remove existing shingles",
    note: null,
    code: "RF-100",
    quantity: 2,
    unit: "sq",
    unit_price: 100,
    total: 200,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// jsdom ships no matchMedia; install a controllable stub. Default: desktop.
function setMatchMedia(isDesktop: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}

beforeEach(() => {
  setMatchMedia(true);
});

describe("LineItemEditorPanel", () => {
  it("renders the selected line's name in the panel", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByTestId("line-item-editor-panel")).toBeDefined();
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");
  });

  it("renders all seven editable fields seeded from the item", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");
    expect(
      (screen.getByTestId("editor-field-code") as HTMLInputElement).value,
    ).toBe("RF-100");
    expect(
      (screen.getByTestId("editor-field-quantity") as HTMLInputElement).value,
    ).toBe("2");
    expect(
      (screen.getByTestId("editor-field-unit") as HTMLInputElement).value,
    ).toBe("sq");
    // Unit cost lives in a MoneyInput; its text box holds the numeric draft.
    const unitCost = within(
      screen.getByTestId("editor-field-unit-cost"),
    ).getByRole("textbox") as HTMLInputElement;
    expect(unitCost.value).toBe("100");
    expect(
      (screen.getByTestId("editor-field-description") as HTMLTextAreaElement)
        .value,
    ).toBe("Remove existing shingles");
    expect(
      (screen.getByTestId("editor-field-note") as HTMLInputElement).value,
    ).toBe("");
  });

  it("commits an edited field on blur, trimmed, via onChange", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={onChange} onClose={vi.fn()} />,
    );

    const nameField = screen.getByTestId("editor-field-name") as HTMLInputElement;
    fireEvent.change(nameField, { target: { value: "  Ridge vent  " } });
    fireEvent.blur(nameField);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ name: "Ridge vent" });
  });

  it("reverts an emptied description on blur (description is required)", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={onChange} onClose={vi.fn()} />,
    );

    const descField = screen.getByTestId(
      "editor-field-description",
    ) as HTMLTextAreaElement;
    fireEvent.change(descField, { target: { value: "   " } });
    fireEvent.blur(descField);

    // No commit, and the field snaps back to the item's description.
    expect(onChange).not.toHaveBeenCalled();
    expect(descField.value).toBe("Remove existing shingles");
  });

  it("commits an edited description on blur, trimmed", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={onChange} onClose={vi.fn()} />,
    );

    const descField = screen.getByTestId(
      "editor-field-description",
    ) as HTMLTextAreaElement;
    fireEvent.change(descField, { target: { value: "  Install drip edge  " } });
    fireEvent.blur(descField);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ description: "Install drip edge" });
  });

  it("commits a parsed quantity on blur and reverts a non-numeric one", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={onChange} onClose={vi.fn()} />,
    );

    const qtyField = screen.getByTestId(
      "editor-field-quantity",
    ) as HTMLInputElement;

    fireEvent.change(qtyField, { target: { value: "5" } });
    fireEvent.blur(qtyField);
    expect(onChange).toHaveBeenCalledWith({ quantity: 5 });

    onChange.mockClear();

    // Non-numeric → revert, no commit.
    fireEvent.change(qtyField, { target: { value: "abc" } });
    fireEvent.blur(qtyField);
    expect(onChange).not.toHaveBeenCalled();
    expect(qtyField.value).toBe("2");
  });

  it("commits trimmed optional fields, nulling them when emptied", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={onChange} onClose={vi.fn()} />,
    );

    // Code, unit and note are all nullable — empty commits as null.
    const codeField = screen.getByTestId("editor-field-code") as HTMLInputElement;
    fireEvent.change(codeField, { target: { value: "  " } });
    fireEvent.blur(codeField);
    expect(onChange).toHaveBeenCalledWith({ code: null });

    const unitField = screen.getByTestId("editor-field-unit") as HTMLInputElement;
    fireEvent.change(unitField, { target: { value: " lf " } });
    fireEvent.blur(unitField);
    expect(onChange).toHaveBeenCalledWith({ unit: "lf" });

    const noteField = screen.getByTestId("editor-field-note") as HTMLInputElement;
    fireEvent.change(noteField, { target: { value: "  Owner-supplied  " } });
    fireEvent.blur(noteField);
    expect(onChange).toHaveBeenCalledWith({ note: "Owner-supplied" });
  });

  it("shows a live line total that tracks quantity and unit cost while typing", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    const total = screen.getByTestId("editor-line-total");
    // Seeded: 2 × $100 = $200.00.
    expect(total.textContent).toBe("$200.00");

    // Quantity ticks the total without waiting for a commit.
    const qtyField = screen.getByTestId(
      "editor-field-quantity",
    ) as HTMLInputElement;
    fireEvent.change(qtyField, { target: { value: "3" } });
    expect(total.textContent).toBe("$300.00");

    // Unit cost ticks it too (MoneyInput.onValueChange).
    const unitCost = within(
      screen.getByTestId("editor-field-unit-cost"),
    ).getByRole("textbox") as HTMLInputElement;
    fireEvent.change(unitCost, { target: { value: "50" } });
    expect(total.textContent).toBe("$150.00");
  });

  it("closes via the close control", () => {
    const onClose = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape is pressed inside the panel", () => {
    const onClose = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={onClose} />,
    );

    fireEvent.keyDown(screen.getByTestId("line-item-editor-panel"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables every field when readOnly (voided entity)", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        readOnly
      />,
    );

    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-code") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-quantity") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-unit") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-description") as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-note") as HTMLInputElement).disabled,
    ).toBe(true);
    const unitCost = within(
      screen.getByTestId("editor-field-unit-cost"),
    ).getByRole("textbox") as HTMLInputElement;
    expect(unitCost.readOnly).toBe(true);
  });

  it("docks on desktop with no scrim", () => {
    // beforeEach installs a desktop matchMedia.
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      screen
        .getByTestId("line-item-editor-panel")
        .getAttribute("data-variant"),
    ).toBe("desktop");
    expect(screen.queryByTestId("editor-scrim")).toBeNull();
  });

  it("renders as a slide-up sheet with a dismiss scrim on phone", () => {
    setMatchMedia(false); // phone viewport
    const onClose = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={onClose} />,
    );

    expect(
      screen
        .getByTestId("line-item-editor-panel")
        .getAttribute("data-variant"),
    ).toBe("phone");

    // Tapping the scrim dismisses the sheet.
    fireEvent.click(screen.getByTestId("editor-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reseeds every field when the selected line is swapped", () => {
    const { rerender } = render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );
    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Tear-off");

    const other = makeItem({
      id: "B",
      name: "Ridge cap",
      description: "Cap the ridge",
      code: "RF-200",
      quantity: 4,
      unit: "lf",
      unit_price: 12,
      total: 48,
      note: "Owner-supplied",
    });
    rerender(
      <LineItemEditorPanel item={other} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      (screen.getByTestId("editor-field-name") as HTMLInputElement).value,
    ).toBe("Ridge cap");
    expect(
      (screen.getByTestId("editor-field-code") as HTMLInputElement).value,
    ).toBe("RF-200");
    expect(
      (screen.getByTestId("editor-field-quantity") as HTMLInputElement).value,
    ).toBe("4");
    expect(
      (screen.getByTestId("editor-field-unit") as HTMLInputElement).value,
    ).toBe("lf");
    expect(
      (screen.getByTestId("editor-field-description") as HTMLTextAreaElement)
        .value,
    ).toBe("Cap the ridge");
    expect(
      (screen.getByTestId("editor-field-note") as HTMLInputElement).value,
    ).toBe("Owner-supplied");
    const unitCost = within(
      screen.getByTestId("editor-field-unit-cost"),
    ).getByRole("textbox") as HTMLInputElement;
    expect(unitCost.value).toBe("12");
    // Live total recomputes from the swapped line: 4 × $12 = $48.00.
    expect(screen.getByTestId("editor-line-total").textContent).toBe("$48.00");
  });

  it("focuses the name field when the panel opens", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("editor-field-name"),
    );
  });

  it("moves focus to the name field when swapped to a new line", () => {
    const { rerender } = render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    // Move focus off the name field, then swap lines.
    (screen.getByTestId("editor-field-quantity") as HTMLInputElement).focus();
    rerender(
      <LineItemEditorPanel
        item={makeItem({ id: "B", name: "Ridge cap" })}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByTestId("editor-field-name"),
    );
  });
});
