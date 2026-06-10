// Component test for the settings preset editor — the #576 overhead/profit
// toggles. Both preset types edit them like any other switch (#575 carried the
// split onto invoices) and Save sends them in the PUT body.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

import PresetEditClient from "./preset-edit-client";
import type { PdfPreset } from "@/lib/types";

function makePreset(over: Partial<PdfPreset> = {}): PdfPreset {
  return {
    id: "preset-1",
    organization_id: "org-1",
    name: "House Style",
    document_type: "estimate",
    document_title: "Estimate",
    show_markup: true,
    show_overhead: true, // #576 — non-default, so the save body is provably from state
    show_profit: false,
    show_discount: true,
    show_tax: true,
    show_opening_statement: true,
    show_closing_statement: true,
    show_category_subtotals: false,
    show_code_column: true,
    show_item_notes: true,
    is_default: false,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

describe("PresetEditClient — overhead/profit toggles (#576)", () => {
  it("renders both toggles for an estimate preset and sends them in the save body", async () => {
    render(<PresetEditClient initial={makePreset()} />);

    // getByRole throws if the switch is missing — truthiness is the assertion.
    expect(
      screen.getByRole("switch", { name: /show overhead row in totals/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: /show profit row in totals/i }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.show_overhead).toBe(true);
    expect(body.show_profit).toBe(false);
  });

  // Same decision as the live layout panel: #575 carried the overhead/profit
  // split onto invoices, so an invoice preset offers the two switches too.
  it("offers both toggles on an invoice preset too", () => {
    render(
      <PresetEditClient
        initial={makePreset({ document_type: "invoice", document_title: "Invoice" })}
      />,
    );

    expect(
      screen.getByRole("switch", { name: /show overhead row in totals/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: /show profit row in totals/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: /show markup row in totals/i }),
    ).toBeTruthy();
  });
});
