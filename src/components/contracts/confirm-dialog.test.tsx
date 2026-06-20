// Tests for the shared destructive-confirm modal (contracts/confirm-dialog).
// #631 wired this dialog in front of the Estimate Builder's line-item delete,
// layered above a touch editor that runs its OWN window-level Escape handler.
// A bare modal let Escape fall through and close the whole editor; these pin the
// dialog's keyboard + focus contract so it owns its own dismissal: Escape
// cancels (and is captured so it never reaches a surrounding handler), focus
// moves into the dialog on open and is restored on close, and Tab stays trapped.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";

import ConfirmDialog from "./confirm-dialog";

function renderDialog(
  overrides: Partial<ComponentProps<typeof ConfirmDialog>> = {},
) {
  const props: ComponentProps<typeof ConfirmDialog> = {
    open: true,
    ariaLabel: "Delete thing",
    title: "Delete thing?",
    body: "This can't be undone.",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe("ConfirmDialog", () => {
  it("cancels when Escape is pressed", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not fire onCancel on Escape when it is closed", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={false}
        ariaLabel="x"
        title="x"
        body="x"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("swallows Escape so a surrounding window handler never sees it", () => {
    // The editor panel listens for Escape on the window (bubble phase) to close
    // itself. The dialog must capture + stop the event so cancelling the confirm
    // doesn't also tear down the surface behind it.
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      renderDialog();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(outer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("moves focus onto the Cancel action on open", () => {
    renderDialog();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /cancel/i }),
    );
  });

  it("restores focus to the opener when it closes", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = render(
      <ConfirmDialog
        open
        ariaLabel="x"
        title="x"
        body="x"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Focus moved into the dialog…
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <ConfirmDialog
        open={false}
        ariaLabel="x"
        title="x"
        body="x"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // …and is handed back to the opener on close.
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });

  it("traps Tab within the dialog's two actions", () => {
    renderDialog();
    const cancel = screen.getByRole("button", { name: /cancel/i });
    const confirm = screen.getByRole("button", { name: /^delete$/i });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  // Click contract (#744). The shared modal backs the contracts delete /
  // permanently-delete modals and the estimate builder's line-item guard, so a
  // silent break in any of these — e.g. dropping the inner card's
  // stopPropagation so a click inside it bubbles to the overlay and dismisses —
  // would land across every caller. These pin all three behaviors.
  it("dismisses via onCancel when the overlay backdrop is clicked", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not dismiss when a click lands inside the inner card", () => {
    const { onCancel, onConfirm } = renderDialog();
    // The card stops propagation so clicks inside it never reach the overlay's
    // dismiss handler. Click the card itself (the dialog's only child).
    const card = screen.getByRole("dialog").firstElementChild as HTMLElement;
    fireEvent.click(card);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires onConfirm once (and never onCancel) when Confirm is clicked", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
