// Slice 5 of the #681 add-then-reorder fix. The create-line-item POST now
// returns the parent's freshly-bumped updated_at (Slices 1–2). The dialog must
// hand that token to onAdded as meta so the builder can adopt it before the
// reorder PUT — otherwise that PUT carries a stale snapshot, 409s, and the new
// row is stranded at the bottom. Here we drive the real Custom tab and assert
// onAdded receives (line_item, { updated_at }).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { AddItemDialog } from "./add-item-dialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({
        line_item: { id: "NEW", section_id: "sec-1", description: "Dump fees" },
        updated_at: "2026-03-03T00:00:00Z",
      }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function addCustomItem(mode: "estimate" | "invoice") {
  const onAdded = vi.fn();
  render(
    <AddItemDialog
      open
      onOpenChange={() => {}}
      estimateId={mode === "invoice" ? "inv-1" : "est-1"}
      sectionId="sec-1"
      onAdded={onAdded}
      initialTab="custom"
      mode={mode}
    />,
  );

  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: "Dump fees" },
  });
  fireEvent.change(screen.getByLabelText(/unit price/i), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));

  await waitFor(() => expect(onAdded).toHaveBeenCalled());
  return onAdded;
}

describe("AddItemDialog → onAdded meta (#681)", () => {
  it("threads the estimate POST's updated_at to onAdded as meta", async () => {
    const onAdded = await addCustomItem("estimate");
    expect(onAdded.mock.calls[0][1]).toEqual({ updated_at: "2026-03-03T00:00:00Z" });
  });

  it("threads the invoice POST's updated_at to onAdded as meta", async () => {
    const onAdded = await addCustomItem("invoice");
    expect(onAdded.mock.calls[0][1]).toEqual({ updated_at: "2026-03-03T00:00:00Z" });
  });
});
