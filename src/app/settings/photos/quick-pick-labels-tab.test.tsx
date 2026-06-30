// Quick-pick labels admin tab (#819) — hardening from the #804 review (#857):
// default rows expose no Edit, the icon buttons carry accessible names, and the
// inputs mirror the server's label-length cap.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuickPickLabelsTab } from "./quick-pick-labels-tab";
import { QUICK_PICK_LABEL_MAX_LENGTH } from "@/lib/types";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as never;
});
afterEach(() => vi.restoreAllMocks());

const ql = (overrides: Record<string, unknown> = {}) => ({
  id: "ql-1",
  organization_id: "org-1",
  label: "My Label",
  sort_order: 2,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...overrides,
});

const defaultRow = ql({
  id: "ql-default",
  organization_id: null,
  label: "Source of loss",
  sort_order: 1,
});
const orgRow = ql();

// Render the tab with a mocked GET returning `rows`, waiting until the list paints.
async function renderWith(rows: Record<string, unknown>[]) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => rows });
  render(<QuickPickLabelsTab />);
  await screen.findByText(rows[0].label as string);
}

describe("QuickPickLabelsTab — accessible names (#857)", () => {
  it("gives the reorder, edit, and delete icon buttons accessible names", async () => {
    await renderWith([defaultRow, orgRow]);

    expect(screen.getByRole("button", { name: "Move My Label up" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Move My Label down" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit My Label" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete My Label" })).toBeDefined();
  });
});

// The route 403s mutations to NULL-org default rows, so an inline edit of one
// silently no-ops while still toasting success. Removing the Edit control from
// default rows (a Lock already marks them read-only) keeps the UI honest (#857).
describe("QuickPickLabelsTab — default rows are read-only (#857)", () => {
  it("renders no Edit control for shared default (NULL-org) rows", async () => {
    await renderWith([defaultRow, orgRow]);

    expect(screen.queryByRole("button", { name: "Edit Source of loss" })).toBeNull();
    // org-owned rows keep their Edit control
    expect(screen.getByRole("button", { name: "Edit My Label" })).toBeDefined();
  });
});

// The inputs cap input length to the same value the route enforces, so a user
// can't even type past the server's limit (#857).
describe("QuickPickLabelsTab — input length mirrors the server cap (#857)", () => {
  it("caps the add-label input at the server max length", async () => {
    await renderWith([orgRow]);
    fireEvent.click(screen.getByRole("button", { name: /add label/i }));

    const input = screen.getByPlaceholderText(/source of loss/i);
    expect(input.getAttribute("maxlength")).toBe(String(QUICK_PICK_LABEL_MAX_LENGTH));
  });

  it("caps the inline-edit input at the server max length", async () => {
    await renderWith([orgRow]);
    fireEvent.click(screen.getByRole("button", { name: "Edit My Label" }));

    const input = screen.getByDisplayValue("My Label");
    expect(input.getAttribute("maxlength")).toBe(String(QUICK_PICK_LABEL_MAX_LENGTH));
  });
});
