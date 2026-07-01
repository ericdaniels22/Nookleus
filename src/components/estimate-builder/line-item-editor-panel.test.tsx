// Isolated component tests for LineItemEditorPanel (#544). The panel is the new
// editor surface for a selected line: seven fields, draft + commit-on-blur
// through the shared change pathway, a live line total, and a responsive shell
// (docked on desktop / slide-up sheet on phone). Builder wiring is covered
// separately in line-item-editor-panel.integration.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

import { LineItemEditorPanel } from "./line-item-editor-panel";
import type { EstimateLineItem, InvoiceLineItem } from "@/lib/types";
import type { SketchSource } from "@/lib/sketch/pull-resolver";

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
    pricing_mode: "standard",
    pieces: null,
    days: null,
    sketch_source: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// An Invoice row carries `amount` instead of `total` but the same equipment
// fields (#684). The editor panel treats both identically once equipment
// pricing is enabled for invoice mode.
function makeInvoiceItem(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    id: "A",
    organization_id: "org-1",
    invoice_id: "inv-1",
    section_id: "S1",
    library_item_id: null,
    name: "Excavator rental",
    description: "Mini excavator",
    note: null,
    code: "EQ-100",
    quantity: 2,
    unit: "ea",
    unit_price: 100,
    amount: 200,
    pricing_mode: "standard",
    pieces: null,
    days: null,
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

  it("closes on Escape even when focus has left the panel subtree (global)", () => {
    const onClose = vi.fn();
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={onClose} />,
    );

    // Escape fired from the document body (focus is no longer in the panel) —
    // the local onKeyDown wouldn't see this; a window-level listener does.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not steal Escape from a modal dialog layered above it", () => {
    const onClose = vi.fn();
    render(
      <>
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={onClose}
        />
        <div role="dialog">
          <button data-testid="dialog-button">Cancel</button>
        </div>
      </>,
    );

    // Escape originating inside an open dialog must close the dialog, not the
    // editor panel — the global listener bows out when the event comes from a
    // [role="dialog"] subtree.
    fireEvent.keyDown(screen.getByTestId("dialog-button"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
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

  it("docks with sticky positioning so it can follow scroll (#629)", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    const panel = screen.getByTestId("line-item-editor-panel");
    expect(panel.getAttribute("data-variant")).toBe("desktop");
    // The scroll-follow fix (#629) hinges on the dock keeping `sticky top-6`;
    // jsdom can't observe real pinning, so guard the class against regression.
    expect(panel.className).toContain("sticky");
    expect(panel.className).toContain("top-6");
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

// Issue #630 — touch-accessible delete. The row's only delete control is a
// hover-only trash icon, invisible on a touchscreen. The editor panel gains a
// prominent "Delete line item" button so a line can be removed by tapping.
// These cases pin the panel's affordance in isolation — that it renders, and
// when it's gated. What tapping it *does* (open the #631 confirm, then run the
// existing onLineItemDelete pathway) is covered by the #631 block below.
describe("LineItemEditorPanel — delete affordance (#630)", () => {
  it("renders a Delete line item button when onDelete is provided and editable", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /delete line item/i }),
    ).toBeDefined();
  });

  it("hides the delete button on a read-only (voided) entity", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        readOnly
      />,
    );

    expect(
      screen.queryByRole("button", { name: /delete line item/i }),
    ).toBeNull();
  });

  it("renders no delete button when onDelete is omitted", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /delete line item/i }),
    ).toBeNull();
  });

  it("gives the delete button a finger-friendly tap target (AC 3)", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // jsdom can't measure layout; guard the 44px min-height class (iOS minimum).
    expect(
      screen.getByRole("button", { name: /delete line item/i }).className,
    ).toContain("min-h-[44px]");
  });

  it("gives the close (X) button a finger-friendly tap target (#746)", () => {
    // On the iPad docked variant the X is the ONLY visible dismiss control (the
    // tap-dismiss scrim is phone-only), so its 24px icon-button hitbox is too
    // small to tap reliably. Guard both axes at the 44px minimum; the 16px icon
    // stays, centered within the larger target.
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    const close = screen.getByRole("button", { name: /close editor/i }).className;
    expect(close).toContain("min-h-[44px]");
    expect(close).toContain("min-w-[44px]");
  });

  it("shows the delete button in the phone slide-up sheet too", () => {
    setMatchMedia(false); // phone viewport
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // The footer lives outside the desktop/phone class branch, so the
    // destructive action is reachable in the slide-up sheet, not only the dock.
    // (What tapping it does — open the confirm guard — is covered by #631.)
    expect(
      screen.getByTestId("line-item-editor-panel").getAttribute("data-variant"),
    ).toBe("phone");
    expect(
      screen.getByRole("button", { name: /delete line item/i }),
    ).toBeDefined();
  });
});

// Issue #683 — duplicate affordance. A "Duplicate" button sits next to Delete in
// the editor footer. These cases pin the panel's affordance in isolation — that
// it renders, fires its callback on a single tap (no confirm — it's
// non-destructive), and is gated like Delete. What the callback *does* (clone +
// insert-after + select the copy, per mode) is wired and verified in
// estimate-builder.
describe("LineItemEditorPanel — duplicate affordance (#683)", () => {
  it("renders a Duplicate button when onDuplicate is provided and editable", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /duplicate/i }),
    ).toBeDefined();
  });

  it("fires onDuplicate on a single tap (no confirm)", () => {
    const onDuplicate = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDuplicate={onDuplicate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("hides the duplicate button on a read-only (voided) entity", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        readOnly
      />,
    );

    expect(
      screen.queryByRole("button", { name: /duplicate/i }),
    ).toBeNull();
  });

  it("renders no duplicate button when onDuplicate is omitted", () => {
    render(
      <LineItemEditorPanel item={makeItem()} onChange={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /duplicate/i }),
    ).toBeNull();
  });
});

// Issue #631 — confirmation guard. The #630 delete button now opens a shared
// "Delete line item?" confirm instead of deleting on the first tap, so an
// accidental touch can't silently remove work. Cancel aborts; Confirm runs the
// existing delete pathway. The confirm renders inside the panel's own stacking
// context so it layers above both the docked editor and the z-50 phone sheet.
describe("LineItemEditorPanel — delete confirmation (#631)", () => {
  function deleteButton() {
    return screen.getByRole("button", { name: /delete line item/i });
  }

  it("opens a confirmation instead of deleting on the first tap", () => {
    const onDelete = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(deleteButton());

    // Nothing is deleted yet — the destructive action is guarded.
    expect(onDelete).not.toHaveBeenCalled();
    // A confirmation appears, stating the action can't be undone.
    const dialog = screen.getByRole("dialog", { name: /delete line item/i });
    expect(within(dialog).getByText(/can't be undone/i)).toBeDefined();
  });

  it("deletes the line exactly once when the confirmation is confirmed", () => {
    const onDelete = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(deleteButton());
    const dialog = screen.getByRole("dialog", { name: /delete line item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    // Confirm runs the delete pathway exactly once and dismisses the prompt.
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /delete line item/i })).toBeNull();
  });

  it("closes the confirmation without deleting when cancelled", () => {
    const onDelete = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(deleteButton());
    const dialog = screen.getByRole("dialog", { name: /delete line item/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    // Cancel aborts: no delete, and the prompt is gone (the line survives).
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /delete line item/i })).toBeNull();
  });

  it("renders the confirmation within the editor panel's stacking context", () => {
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(deleteButton());

    // The confirm is a descendant of the panel — not a detached sibling — so it
    // inherits the panel's stacking context and paints above it in both the
    // docked variant and the z-50 phone sheet (real layering isn't observable in
    // jsdom; DOM containment is the structural contract that guarantees it).
    const panel = screen.getByTestId("line-item-editor-panel");
    const dialog = screen.getByRole("dialog", { name: /delete line item/i });
    expect(panel.contains(dialog)).toBe(true);
  });

  it("guards delete in the phone slide-up sheet too", () => {
    setMatchMedia(false); // phone viewport
    const onDelete = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const panel = screen.getByTestId("line-item-editor-panel");
    expect(panel.getAttribute("data-variant")).toBe("phone");

    fireEvent.click(deleteButton());
    const dialog = screen.getByRole("dialog", { name: /delete line item/i });
    // Nested in the z-50 sheet's stacking context — not hidden behind it.
    expect(panel.contains(dialog)).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("cancels the confirmation, not the editor, when Escape is pressed while it is open", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={onClose}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(deleteButton());
    expect(
      screen.getByRole("dialog", { name: /delete line item/i }),
    ).toBeDefined();

    // Escape must dismiss the confirm only. The panel's own window-level
    // Escape-to-close must NOT fire and tear the editor down underneath the
    // open confirm (the #631 layering bug). The confirm owns Escape now.
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: /delete line item/i }),
    ).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

// Issue #682 — equipment pricing (pieces × days). An estimate line gains a
// "Bill as" toggle: Standard (a single Quantity) or Pieces × Days. In equipment
// mode the Quantity input is replaced by Pieces and Days, the manual Note field
// is hidden (the derived "N units for M days" note owns the slot), and the live
// total is pieces × days × unit cost. All edits flow through the pure
// reconcilers in equipment-pricing.ts via the shared onChange pathway. Gated to
// the Estimate builder (mode === "estimate"); invoice/template panels are
// unchanged.
describe("LineItemEditorPanel — equipment pricing (#682)", () => {
  it("switches a standard row into equipment mode via the Bill-as toggle", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    // Standard by default: the Quantity field is shown, no Pieces/Days yet.
    expect(screen.getByTestId("editor-field-quantity")).toBeDefined();
    expect(screen.queryByTestId("editor-field-pieces")).toBeNull();

    // Flipping to "Pieces × Days" seeds equipment mode from the reconciler:
    // quantity 2 → 2 pieces over 1 day, with the derived note.
    fireEvent.click(screen.getByTestId("editor-bill-as-equipment"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      pricing_mode: "pieces_days",
      pieces: 2,
      days: 1,
      quantity: 2,
      note: "2 units for 1 day",
    });
  });

  it("switches an Invoice row into equipment mode via the Bill-as toggle (#684)", () => {
    // The shared panel now enables equipment pricing on Invoices too, so a
    // rental billed by Pieces × Days can be edited directly on the Invoice
    // exactly as on the Estimate.
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={makeInvoiceItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="invoice"
      />,
    );

    expect(screen.getByTestId("editor-field-quantity")).toBeDefined();
    expect(screen.queryByTestId("editor-field-pieces")).toBeNull();

    fireEvent.click(screen.getByTestId("editor-bill-as-equipment"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      pricing_mode: "pieces_days",
      pieces: 2,
      days: 1,
      quantity: 2,
      note: "2 units for 1 day",
    });
  });

  // An item already billed as pieces × days.
  function equipmentItem(overrides: Partial<EstimateLineItem> = {}) {
    return makeItem({
      pricing_mode: "pieces_days",
      pieces: 3,
      days: 10,
      quantity: 30,
      unit_price: 100,
      total: 3000,
      note: "3 units for 10 days",
      ...overrides,
    });
  }

  it("replaces the Quantity input with Pieces and Days, seeded from the row", () => {
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    expect(screen.queryByTestId("editor-field-quantity")).toBeNull();
    expect(
      (screen.getByTestId("editor-field-pieces") as HTMLInputElement).value,
    ).toBe("3");
    expect(
      (screen.getByTestId("editor-field-days") as HTMLInputElement).value,
    ).toBe("10");
  });

  it("commits an edited piece count on blur through setPieces", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    const pieces = screen.getByTestId("editor-field-pieces") as HTMLInputElement;
    fireEvent.change(pieces, { target: { value: "5" } });
    fireEvent.blur(pieces);

    // setPieces recomputes quantity (5 × 10) and the derived note.
    expect(onChange).toHaveBeenCalledWith({
      pieces: 5,
      quantity: 50,
      note: "5 units for 10 days",
    });
  });

  it("commits an edited day count on blur through setDays", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    const days = screen.getByTestId("editor-field-days") as HTMLInputElement;
    fireEvent.change(days, { target: { value: "7" } });
    fireEvent.blur(days);

    expect(onChange).toHaveBeenCalledWith({
      days: 7,
      quantity: 21,
      note: "3 units for 7 days",
    });
  });

  it("reverts a non-numeric piece count on blur without committing", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    const pieces = screen.getByTestId("editor-field-pieces") as HTMLInputElement;
    fireEvent.change(pieces, { target: { value: "abc" } });
    fireEvent.blur(pieces);

    expect(onChange).not.toHaveBeenCalled();
    expect(pieces.value).toBe("3");
  });

  it("hides the manual Note field and shows the derived note", () => {
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    expect(screen.queryByTestId("editor-field-note")).toBeNull();
    expect(screen.getByTestId("editor-derived-note").textContent).toBe(
      "3 units for 10 days",
    );
  });

  it("ticks the live total and derived note off pieces × days while typing", () => {
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    // Seeded: 3 × 10 × $100 = $3,000.00.
    expect(screen.getByTestId("editor-line-total").textContent).toBe("$3,000.00");

    const pieces = screen.getByTestId("editor-field-pieces") as HTMLInputElement;
    fireEvent.change(pieces, { target: { value: "4" } });

    // 4 × 10 × $100 = $4,000.00, note follows without waiting for a commit.
    expect(screen.getByTestId("editor-line-total").textContent).toBe("$4,000.00");
    expect(screen.getByTestId("editor-derived-note").textContent).toBe(
      "4 units for 10 days",
    );
  });

  it("switches back to standard mode via the toggle through toStandardMode", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    fireEvent.click(screen.getByTestId("editor-bill-as-standard"));

    // toStandardMode clears pieces/days and releases the note; quantity is kept
    // by the server, so it isn't in the partial.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      pricing_mode: "standard",
      pieces: null,
      days: null,
      note: "",
    });
  });

  it("disables the toggle and Pieces/Days inputs on a read-only entity", () => {
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        mode="estimate"
        readOnly
      />,
    );

    expect(
      (screen.getByTestId("editor-field-pieces") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-field-days") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-bill-as-standard") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("editor-bill-as-equipment") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("seeds the Pieces/Days inputs when the row is toggled into equipment mode (same line)", () => {
    // Real-app flow: clicking the toggle dispatches the reconciler partial, the
    // parent merges it onto the SAME line (id unchanged) and re-renders. The
    // Pieces/Days inputs must reflect the reconciled values — not stay blank
    // from their standard-mode mount seed.
    const onChange = vi.fn();
    const { rerender } = render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    fireEvent.click(screen.getByTestId("editor-bill-as-equipment"));
    const partial = onChange.mock.calls[0][0] as Partial<EstimateLineItem>;

    // Parent applies the partial to the same line and re-renders.
    rerender(
      <LineItemEditorPanel
        item={makeItem(partial)}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    expect(screen.queryByTestId("editor-field-quantity")).toBeNull();
    expect(
      (screen.getByTestId("editor-field-pieces") as HTMLInputElement).value,
    ).toBe("2");
    expect(
      (screen.getByTestId("editor-field-days") as HTMLInputElement).value,
    ).toBe("1");
    expect(screen.getByTestId("editor-derived-note").textContent).toBe(
      "2 units for 1 day",
    );
  });

  it("restores an editable, empty Note when toggled back to standard (same line)", () => {
    // The mirror transition: equipment → standard on the same line must bring
    // back the manual Note field, seeded from the released (cleared) note.
    const onChange = vi.fn();
    const { rerender } = render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    fireEvent.click(screen.getByTestId("editor-bill-as-standard"));
    const partial = onChange.mock.calls[0][0] as Partial<EstimateLineItem>;

    rerender(
      <LineItemEditorPanel
        item={equipmentItem(partial)}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    expect(screen.queryByTestId("editor-field-pieces")).toBeNull();
    expect(screen.getByTestId("editor-field-quantity")).toBeDefined();
    const noteField = screen.getByTestId("editor-field-note") as HTMLInputElement;
    expect(noteField.value).toBe("");
  });

  it("reverts a zero or negative piece count on blur without committing", () => {
    // Equipment rentals are positive by design (toEquipmentMode/seedFromLibraryItem
    // both guard `> 0 ? x : 1`), so a non-positive entry must revert, not persist
    // a "0 units" / negative-quantity row.
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    const pieces = screen.getByTestId("editor-field-pieces") as HTMLInputElement;

    fireEvent.change(pieces, { target: { value: "0" } });
    fireEvent.blur(pieces);
    expect(onChange).not.toHaveBeenCalled();
    expect(pieces.value).toBe("3");

    fireEvent.change(pieces, { target: { value: "-2" } });
    fireEvent.blur(pieces);
    expect(onChange).not.toHaveBeenCalled();
    expect(pieces.value).toBe("3");
  });

  it("reverts a zero or negative day count on blur without committing", () => {
    const onChange = vi.fn();
    render(
      <LineItemEditorPanel
        item={equipmentItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    const days = screen.getByTestId("editor-field-days") as HTMLInputElement;

    fireEvent.change(days, { target: { value: "0" } });
    fireEvent.blur(days);
    expect(onChange).not.toHaveBeenCalled();
    expect(days.value).toBe("10");

    fireEvent.change(days, { target: { value: "-1" } });
    fireEvent.blur(days);
    expect(onChange).not.toHaveBeenCalled();
    expect(days.value).toBe("10");
  });

  it("resets a stale Quantity draft when toggling billing modes on the same line", () => {
    // An uncommitted Quantity edit must not survive a round-trip through
    // equipment mode (where Quantity is hidden) back to standard. The mode-flip
    // reseed has to reset the Quantity draft too, like the line-swap reseed does.
    const onChange = vi.fn();
    const { rerender } = render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    // Edit Quantity without blurring (no commit).
    fireEvent.change(screen.getByTestId("editor-field-quantity"), {
      target: { value: "999" },
    });

    // Toggle to equipment; the parent applies the reconciler partial to the line.
    fireEvent.click(screen.getByTestId("editor-bill-as-equipment"));
    const toEquip = onChange.mock.calls[0][0] as Partial<EstimateLineItem>;
    rerender(
      <LineItemEditorPanel
        item={makeItem(toEquip)}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    // Toggle back to standard; apply that partial too.
    fireEvent.click(screen.getByTestId("editor-bill-as-standard"));
    const toStd = onChange.mock.calls[1][0] as Partial<EstimateLineItem>;
    rerender(
      <LineItemEditorPanel
        item={makeItem({ ...toEquip, ...toStd })}
        onChange={onChange}
        onClose={vi.fn()}
        mode="estimate"
      />,
    );

    // Quantity reflects the item (2), not the stale 999 draft.
    expect(
      (screen.getByTestId("editor-field-quantity") as HTMLInputElement).value,
    ).toBe("2");
  });

  it("shows no Bill-as toggle in the Template builder", () => {
    // Estimate (#682) and Invoice (#684) builders share this panel and both
    // expose equipment pricing; the Template builder does not — the toggle is
    // gated on mode === "estimate" || mode === "invoice".
    render(
      <LineItemEditorPanel
        item={makeItem()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        mode="template"
      />,
    );

    expect(screen.queryByTestId("editor-bill-as")).toBeNull();
    // The standard Quantity field still renders as before.
    expect(screen.getByTestId("editor-field-quantity")).toBeDefined();
  });

  // ── Sketch source (#861) ───────────────────────────────────────────────────
  // The panel is where a line item's quantity is pulled — and frozen — from a
  // Sketch Room, and where the resulting source breadcrumb is surfaced.
  describe("Sketch source (#861)", () => {
    const SOURCE: SketchSource = {
      scope: "room",
      sketch_id: "sk-1",
      floor_id: "fl-1",
      room_id: "rm-1",
      room_name: "Living Room",
      kind: "wall_area_net",
      value: 100,
      pulled_at: "2026-06-30T12:00:00.000Z",
    };

    it("shows the source badge when the line was pulled from a Sketch Room", () => {
      // A line carrying a frozen sketch_source reads as Sketch-sourced: the badge
      // names the Room and the measurement kind so the reader knows where the
      // billed quantity came from (acceptance #3).
      render(
        <LineItemEditorPanel
          item={makeItem({ sketch_source: SOURCE, quantity: 100, total: 10000 })}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
        />,
      );

      const badge = screen.getByTestId("sketch-source-badge");
      expect(badge.textContent).toContain("Living Room");
      expect(badge.textContent).toContain("Net wall area");
    });

    it("shows no source badge for a hand-typed line item", () => {
      // The badge is metadata a non-Sketch row simply doesn't carry (acceptance
      // #2): a null sketch_source renders nothing.
      render(
        <LineItemEditorPanel
          item={makeItem({ sketch_source: null })}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
        />,
      );

      expect(screen.queryByTestId("sketch-source-badge")).toBeNull();
    });

    it("offers a Pull from Sketch affordance when the estimate can pull", () => {
      // When the builder wires the pull callbacks (estimate mode, editable), the
      // panel exposes the affordance that opens the Room picker (acceptance #1).
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
        />,
      );

      expect(screen.getByTestId("sketch-pull-button")).toBeDefined();
    });

    it("hides the Pull from Sketch affordance when no pull callback is wired", () => {
      // Template/invoice builders (and any caller that doesn't opt in) never see
      // the affordance — it's gated on the callback being supplied.
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
        />,
      );

      expect(screen.queryByTestId("sketch-pull-button")).toBeNull();
    });

    it("hides the Pull from Sketch affordance on a read-only estimate", () => {
      // A voided / read-only estimate can't take a fresh pull — the affordance is
      // suppressed even though the callbacks are present.
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          readOnly
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
        />,
      );

      expect(screen.queryByTestId("sketch-pull-button")).toBeNull();
    });

    const ROOM_OPTIONS = [
      {
        id: "rm-1",
        name: "Living Room",
        floor_id: "fl-1",
        floor_name: "Ground floor",
        measurements: {
          floor_area: 12,
          ceiling_area: 13,
          perimeter: 14,
          wall_area_gross: 112,
          wall_area_net: 100,
          volume: 96,
        },
      },
      {
        id: "rm-2",
        name: "Kitchen",
        floor_id: "fl-1",
        floor_name: "Ground floor",
        measurements: {
          floor_area: 50,
          ceiling_area: 51,
          perimeter: 30,
          wall_area_gross: 210,
          wall_area_net: 200,
          volume: 400,
        },
      },
    ];

    // The Floor aggregate (M2) sums both Rooms; with one Floor the whole-Sketch
    // total equals it. These are the Floor-scope and Sketch-scope options.
    const FLOOR_OPTIONS = [
      {
        id: "fl-1",
        name: "Ground floor",
        measurements: {
          floor_area: 62,
          ceiling_area: 64,
          perimeter: 44,
          wall_area_gross: 322,
          wall_area_net: 300,
          volume: 496,
        },
      },
    ];
    const SKETCH_TOTALS = {
      sketch_id: "sk-1",
      measurements: {
        floor_area: 62,
        ceiling_area: 64,
        perimeter: 44,
        wall_area_gross: 322,
        wall_area_net: 300,
        volume: 496,
      },
    };
    const FEED = { rooms: ROOM_OPTIONS, floors: FLOOR_OPTIONS, sketch: SKETCH_TOTALS };

    it("opens the picker and lists the estimate's Sketch Rooms", async () => {
      // Opening the affordance lazily loads the Sketch feed and, in the default
      // Room scope, lists each Room to choose a source from (acceptance #1).
      const onLoadSketchSources = vi.fn().mockResolvedValue(FEED);
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));

      const roomSelect = await screen.findByTestId("sketch-picker-room");
      expect(onLoadSketchSources).toHaveBeenCalledTimes(1);
      expect(within(roomSelect).getAllByRole("option")).toHaveLength(2);
      expect(roomSelect.textContent).toContain("Living Room");
      expect(roomSelect.textContent).toContain("Kitchen");
    });

    it("previews the chosen measurement and freezes it into quantity on Pull", async () => {
      // The picker previews `measurements[kind]` for the selected Room, and Pull
      // hands the parent exactly the scope + roomId + kind the server resolves and
      // freezes (server-authoritative — the panel doesn't compute the value).
      const onLoadSketchSources = vi.fn().mockResolvedValue(FEED);
      const onPullFromSketch = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={onPullFromSketch}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));
      await screen.findByTestId("sketch-picker-room");

      // Net wall area is the default kind; the first Room is preselected, so the
      // preview shows its net wall area (100).
      expect(screen.getByTestId("sketch-picker-preview").textContent).toContain("100");

      // Switch the measurement kind — the preview retargets to floor area (12).
      fireEvent.change(screen.getByTestId("sketch-picker-kind"), {
        target: { value: "floor_area" },
      });
      expect(screen.getByTestId("sketch-picker-preview").textContent).toContain("12");

      fireEvent.click(screen.getByTestId("sketch-picker-pull"));

      await waitFor(() =>
        expect(onPullFromSketch).toHaveBeenCalledWith({
          scope: "room",
          roomId: "rm-1",
          kind: "floor_area",
        }),
      );
      // The picker closes once the pull resolves.
      await waitFor(() =>
        expect(screen.queryByTestId("sketch-picker-room")).toBeNull(),
      );
    });

    it("offers the door/window count kinds and freezes a count on Pull (#866)", async () => {
      // The picker offers the two count kinds alongside the six measurements, so a
      // line item can pull a door/window quantity (#866 acceptance d). Selecting
      // Door count previews the Room's door tally and Pull hands the parent the
      // count kind — the server resolves the number, as with any kind.
      const feed = {
        rooms: [
          {
            id: "rm-1",
            name: "Living Room",
            floor_id: "fl-1",
            floor_name: "Ground floor",
            measurements: {
              floor_area: 12,
              ceiling_area: 13,
              perimeter: 14,
              wall_area_gross: 112,
              wall_area_net: 100,
              volume: 96,
              door_count: 7,
              window_count: 5,
            },
          },
        ],
        floors: [
          {
            id: "fl-1",
            name: "Ground floor",
            measurements: {
              floor_area: 12,
              ceiling_area: 13,
              perimeter: 14,
              wall_area_gross: 112,
              wall_area_net: 100,
              volume: 96,
              door_count: 7,
              window_count: 5,
            },
          },
        ],
        sketch: null,
      };
      const onLoadSketchSources = vi.fn().mockResolvedValue(feed);
      const onPullFromSketch = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={onPullFromSketch}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));
      const kindSelect = await screen.findByTestId("sketch-picker-kind");

      // All eight pull kinds are offered — the six measurements plus the two counts.
      expect(within(kindSelect).getAllByRole("option")).toHaveLength(8);
      expect(kindSelect.textContent).toContain("Door count");
      expect(kindSelect.textContent).toContain("Window count");

      // Selecting Door count previews the Room's door tally (7).
      fireEvent.change(kindSelect, { target: { value: "door_count" } });
      expect(screen.getByTestId("sketch-picker-preview").textContent).toContain("7");

      fireEvent.click(screen.getByTestId("sketch-picker-pull"));
      await waitFor(() =>
        expect(onPullFromSketch).toHaveBeenCalledWith({
          scope: "room",
          roomId: "rm-1",
          kind: "door_count",
        }),
      );
    });

    it("pulls a Floor's total: Floor scope reveals a Floor select and freezes its aggregate", async () => {
      // Switching scope to Floor swaps the Room select for a Floor select and
      // previews the Floor's aggregate; Pull sends the Floor scope + floorId
      // (acceptance #5 — the pull supports Floor scope).
      const onLoadSketchSources = vi.fn().mockResolvedValue(FEED);
      const onPullFromSketch = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={onPullFromSketch}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));
      await screen.findByTestId("sketch-picker-scope");

      fireEvent.change(screen.getByTestId("sketch-picker-scope"), {
        target: { value: "floor" },
      });

      // The Room select gives way to a Floor select; the preview shows the Floor's
      // net-wall-area aggregate (300).
      expect(screen.queryByTestId("sketch-picker-room")).toBeNull();
      const floorSelect = screen.getByTestId("sketch-picker-floor");
      expect(floorSelect.textContent).toContain("Ground floor");
      expect(screen.getByTestId("sketch-picker-preview").textContent).toContain("300");

      fireEvent.click(screen.getByTestId("sketch-picker-pull"));

      await waitFor(() =>
        expect(onPullFromSketch).toHaveBeenCalledWith({
          scope: "floor",
          floorId: "fl-1",
          kind: "wall_area_net",
        }),
      );
    });

    it("pulls the whole-Sketch total: Sketch scope needs no source select and freezes the Sketch aggregate", async () => {
      // Whole-Sketch scope has a single unambiguous source, so it offers no id
      // select; Pull sends only the scope + kind (acceptance #5 — whole-Sketch
      // scope).
      const onLoadSketchSources = vi.fn().mockResolvedValue(FEED);
      const onPullFromSketch = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={onPullFromSketch}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));
      await screen.findByTestId("sketch-picker-scope");

      fireEvent.change(screen.getByTestId("sketch-picker-scope"), {
        target: { value: "sketch" },
      });

      // No Room or Floor select — the whole Sketch is the source. Preview shows
      // the Sketch's net-wall-area total (300).
      expect(screen.queryByTestId("sketch-picker-room")).toBeNull();
      expect(screen.queryByTestId("sketch-picker-floor")).toBeNull();
      expect(screen.getByTestId("sketch-picker-preview").textContent).toContain("300");

      fireEvent.click(screen.getByTestId("sketch-picker-pull"));

      await waitFor(() =>
        expect(onPullFromSketch).toHaveBeenCalledWith({
          scope: "sketch",
          kind: "wall_area_net",
        }),
      );
    });

    it("shows an empty state when the estimate's job has no Sketch", async () => {
      // No Sketch (or an empty one) is a valid state, not an error: the picker
      // says so instead of offering a dead source select.
      const onLoadSketchSources = vi
        .fn()
        .mockResolvedValue({ rooms: [], floors: [], sketch: null });
      render(
        <LineItemEditorPanel
          item={makeItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-pull-button"));

      const empty = await screen.findByTestId("sketch-picker-empty");
      expect(empty.textContent?.length).toBeGreaterThan(0);
      expect(screen.queryByTestId("sketch-picker-room")).toBeNull();
    });
  });

  describe("Re-pull contract (#864)", () => {
    const SOURCE: SketchSource = {
      scope: "room",
      sketch_id: "sk-1",
      floor_id: "fl-1",
      room_id: "rm-1",
      room_name: "Living Room",
      kind: "wall_area_net",
      value: 100,
      pulled_at: "2026-06-01T00:00:00.000Z",
    };

    function sourcedItem() {
      return makeItem({ sketch_source: SOURCE, quantity: 100, total: 10000 });
    }

    it("offers a Re-pull affordance for a line that already has a Sketch source", () => {
      // A Sketch-sourced line's primary Sketch action is Re-pull (#864), not the
      // fresh-pull picker — the picker button is not the primary control here.
      render(
        <LineItemEditorPanel
          item={sourcedItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
          onRepullPreview={vi.fn()}
          onRepullApply={vi.fn()}
        />,
      );

      expect(screen.getByTestId("sketch-repull-button")).toBeDefined();
      expect(screen.queryByTestId("sketch-pull-button")).toBeNull();
    });

    it("previews old-vs-new and applies only after the user confirms", async () => {
      // Clicking Re-pull runs the dry-run preview, then shows old (100) vs new
      // (125) in a confirm — nothing changes yet (#864 AC #2). Only on confirm is
      // the re-pull applied (AC #3).
      const onRepullPreview = vi
        .fn()
        .mockResolvedValue({ old_value: 100, new_value: 125, changed: true });
      const onRepullApply = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={sourcedItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
          onRepullPreview={onRepullPreview}
          onRepullApply={onRepullApply}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-repull-button"));

      // The confirm shows old-vs-new; the apply hasn't fired yet.
      const diff = await screen.findByTestId("repull-old-vs-new");
      expect(diff.textContent).toContain("100");
      expect(diff.textContent).toContain("125");
      expect(onRepullPreview).toHaveBeenCalledTimes(1);
      expect(onRepullApply).not.toHaveBeenCalled();

      // Confirm ("Update quantity") applies the re-pull, echoing the confirmed
      // new value so the server can refuse one that drifted since the preview.
      fireEvent.click(screen.getByRole("button", { name: /update quantity/i }));
      await waitFor(() => expect(onRepullApply).toHaveBeenCalledWith(125));
    });

    it("cancels the re-pull without applying — nothing changes", async () => {
      // Cancelling the confirm leaves the frozen quantity exactly as it was: the
      // apply never fires (#864 AC #3, cancel branch).
      const onRepullPreview = vi
        .fn()
        .mockResolvedValue({ old_value: 100, new_value: 125, changed: true });
      const onRepullApply = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={sourcedItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
          onRepullPreview={onRepullPreview}
          onRepullApply={onRepullApply}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-repull-button"));
      await screen.findByTestId("repull-old-vs-new");

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() =>
        expect(screen.queryByTestId("repull-old-vs-new")).toBeNull(),
      );
      expect(onRepullApply).not.toHaveBeenCalled();
    });

    it("opens no confirm when the preview fails (deleted source)", async () => {
      // A null preview means the source Room is gone (the parent already surfaced
      // the reason). The panel opens no confirm and never applies — the frozen
      // quantity is left untouched (#864 AC #4).
      const onRepullPreview = vi.fn().mockResolvedValue(null);
      const onRepullApply = vi.fn().mockResolvedValue(undefined);
      render(
        <LineItemEditorPanel
          item={sourcedItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={vi.fn()}
          onPullFromSketch={vi.fn()}
          onRepullPreview={onRepullPreview}
          onRepullApply={onRepullApply}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-repull-button"));

      await waitFor(() => expect(onRepullPreview).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("repull-old-vs-new")).toBeNull();
      expect(onRepullApply).not.toHaveBeenCalled();
    });

    it("keeps the fresh-pull picker reachable via Change source", async () => {
      // Re-pointing a sourced line to a different Room/measurement is still
      // possible (#861 capability preserved): "Change source" opens the picker.
      const measurements = {
        floor_area: 12,
        ceiling_area: 13,
        perimeter: 14,
        wall_area_gross: 112,
        wall_area_net: 100,
        volume: 96,
      };
      const onLoadSketchSources = vi.fn().mockResolvedValue({
        rooms: [
          {
            id: "rm-1",
            name: "Living Room",
            floor_id: "fl-1",
            floor_name: "Ground floor",
            measurements,
          },
        ],
        floors: [{ id: "fl-1", name: "Ground floor", measurements }],
        sketch: { sketch_id: "sk-1", measurements },
      });
      render(
        <LineItemEditorPanel
          item={sourcedItem()}
          onChange={vi.fn()}
          onClose={vi.fn()}
          mode="estimate"
          onLoadSketchSources={onLoadSketchSources}
          onPullFromSketch={vi.fn()}
          onRepullPreview={vi.fn()}
          onRepullApply={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId("sketch-change-source-button"));

      await screen.findByTestId("sketch-picker-room");
      expect(onLoadSketchSources).toHaveBeenCalledTimes(1);
    });

    it("discards an in-flight preview when the user switches lines mid-check", async () => {
      // The panel is reused (not remounted) across line switches. If the user
      // clicks Re-pull on line A and switches to line B before A's preview
      // resolves, A's stale preview must NOT open the confirm on B (which would
      // show A's numbers against B's Room and apply to B), and B's button must
      // not be stuck "Checking Sketch…". Guards AC #2's correct-line contract.
      let resolvePreview!: (v: { old_value: number; new_value: number; changed: boolean } | null) => void;
      const onRepullPreview = vi.fn(
        () =>
          new Promise<{ old_value: number; new_value: number; changed: boolean } | null>(
            (r) => {
              resolvePreview = r;
            },
          ),
      );
      const onRepullApply = vi.fn().mockResolvedValue(undefined);

      const itemA = makeItem({
        id: "A",
        quantity: 100,
        total: 10000,
        sketch_source: { ...SOURCE, room_id: "rm-a", room_name: "Kitchen" },
      });
      const itemB = makeItem({
        id: "B",
        quantity: 30,
        total: 3000,
        sketch_source: {
          ...SOURCE,
          room_id: "rm-b",
          room_name: "Bathroom",
          kind: "floor_area",
          value: 30,
        },
      });

      const props = {
        onChange: vi.fn(),
        onClose: vi.fn(),
        mode: "estimate" as const,
        onLoadSketchSources: vi.fn(),
        onPullFromSketch: vi.fn(),
        onRepullPreview,
        onRepullApply,
      };

      const { rerender } = render(<LineItemEditorPanel item={itemA} {...props} />);

      // Start the preview for A (still pending).
      fireEvent.click(screen.getByTestId("sketch-repull-button"));
      expect(onRepullPreview).toHaveBeenCalledTimes(1);

      // Switch to line B before A's preview resolves.
      rerender(<LineItemEditorPanel item={itemB} {...props} />);

      // Now A's preview resolves late.
      await act(async () => {
        resolvePreview({ old_value: 100, new_value: 50, changed: true });
      });

      // No confirm opened on B, and B's button is live (not stuck checking).
      expect(screen.queryByTestId("repull-old-vs-new")).toBeNull();
      const button = screen.getByTestId("sketch-repull-button") as HTMLButtonElement;
      expect(button.textContent).toContain("Re-pull from Sketch");
      expect(button.disabled).toBe(false);
      expect(onRepullApply).not.toHaveBeenCalled();
    });
  });
});
