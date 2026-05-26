import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// #286 — DeleteTemplateConfirmDialog is the hard-delete confirm prompt that
// the Estimate Templates list opens when the user clicks the trash icon on
// a template card. Patterned on TrashConfirmDialog but simpler: no reason
// input, no 30-day soft-trash language, no document-kind switch.

import { DeleteTemplateConfirmDialog } from "./delete-template-confirm-dialog";

describe("DeleteTemplateConfirmDialog", () => {
  it("renders the template name inside the dialog", async () => {
    render(
      <DeleteTemplateConfirmDialog
        open
        onOpenChange={() => {}}
        templateName="Roof Replacement"
        onConfirm={async () => {}}
        isDeleting={false}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Roof Replacement/);
  });

  it("cancel button calls onOpenChange(false) and not onConfirm", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async () => {});

    render(
      <DeleteTemplateConfirmDialog
        open
        onOpenChange={onOpenChange}
        templateName="Roof Replacement"
        onConfirm={onConfirm}
        isDeleting={false}
      />,
    );

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("delete button calls onConfirm", async () => {
    const onConfirm = vi.fn(async () => {});

    render(
      <DeleteTemplateConfirmDialog
        open
        onOpenChange={() => {}}
        templateName="Roof Replacement"
        onConfirm={onConfirm}
        isDeleting={false}
      />,
    );

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("delete button is the destructive variant", async () => {
    render(
      <DeleteTemplateConfirmDialog
        open
        onOpenChange={() => {}}
        templateName="Roof Replacement"
        onConfirm={async () => {}}
        isDeleting={false}
      />,
    );

    await screen.findByRole("dialog");
    const del = screen.getByRole("button", { name: /^delete$/i });
    // bg-destructive is the Tailwind hook the destructive Button variant uses.
    expect(del.className).toMatch(/bg-destructive/);
  });

  it("disables both buttons while isDeleting is true", async () => {
    render(
      <DeleteTemplateConfirmDialog
        open
        onOpenChange={() => {}}
        templateName="Roof Replacement"
        onConfirm={async () => {}}
        isDeleting
      />,
    );

    await screen.findByRole("dialog");
    expect(
      (screen.getByRole("button", { name: /cancel/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // While deleting, label flips to "Deleting…"; assert by data-slot to find it.
    const slotButtons = screen.getAllByRole("button");
    const destructive = slotButtons.find((b) =>
      b.className.includes("bg-destructive"),
    );
    expect(destructive).toBeDefined();
    expect((destructive as HTMLButtonElement).disabled).toBe(true);
  });
});
