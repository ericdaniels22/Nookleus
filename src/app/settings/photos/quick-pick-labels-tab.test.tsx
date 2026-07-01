// Reorder behavior for the Settings → Photos → Quick-pick labels tab (#856),
// plus the #804-review hardening (#857): default rows expose no Edit, the icon
// buttons carry accessible names, and the inputs mirror the server label cap.
//
// The list shows the shared NULL-org defaults (locked, pinned on top) above the
// org's own rows. Only the org rows are movable, and a reorder must:
//   - persist a collision-free sort_order (org rows strictly above the
//     defaults') so the order survives a refresh,
//   - await the write and, on failure, surface an error and snap the UI back to
//     the true persisted order instead of silently keeping the optimistic one.
//
// Mirrors the fetch-stub + sonner-mock pattern from
// documents/export-pdf-button.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { QuickPickLabelsTab } from "./quick-pick-labels-tab";
import { toast } from "sonner";
import { QUICK_PICK_LABEL_MAX_LENGTH } from "@/lib/types";

type Row = {
  id: string;
  organization_id: string | null;
  label: string;
  sort_order: number;
};
const D = (id: string, label: string, sort: number): Row => ({
  id,
  organization_id: null,
  label,
  sort_order: sort,
});
const O = (id: string, label: string, sort: number): Row => ({
  id,
  organization_id: "org-1",
  label,
  sort_order: sort,
});

let server: Row[];
let putBodies: unknown[];
let putOk: boolean;

beforeEach(() => {
  vi.clearAllMocks();
  putBodies = [];
  putOk = true;
  // d1 default (sort 1) pinned above two org rows.
  server = [D("d1", "Source of loss", 1), O("o1", "Mine A", 2), O("o2", "Mine B", 3)];

  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        putBodies.push(JSON.parse(init!.body as string));
        return Promise.resolve({ ok: putOk, json: async () => ({}) } as Response);
      }
      // GET returns the (unchanged) server order.
      return Promise.resolve({ ok: true, json: async () => server } as Response);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

// DOM order of the two org labels, top-to-bottom.
function orgOrder(): string[] {
  return screen.getAllByText(/Mine [AB]/).map((n) => n.textContent);
}

describe("QuickPickLabelsTab — reorder across the default/org boundary", () => {
  it("persists a collision-free payload (org rows above defaults) and keeps the new order", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Mine A");

    fireEvent.click(screen.getByRole("button", { name: "Move Mine A down" }));

    await waitFor(() => expect(putBodies.length).toBe(1));
    // org rows numbered from maxDefault(1)+1, in the new display order.
    expect(putBodies[0]).toEqual([
      { id: "o2", label: "Mine B", sort_order: 2 },
      { id: "o1", label: "Mine A", sort_order: 3 },
    ]);
    expect(orgOrder()).toEqual(["Mine B", "Mine A"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reverts to the true persisted order and toasts when the reorder write fails", async () => {
    putOk = false;
    render(<QuickPickLabelsTab />);
    await screen.findByText("Mine A");

    fireEvent.click(screen.getByRole("button", { name: "Move Mine A down" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // The UI snaps back to the server's true order, not the optimistic one.
    await waitFor(() => expect(orgOrder()).toEqual(["Mine A", "Mine B"]));
  });

  it("gives default rows no move controls — they aren't part of the movable set", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Source of loss");

    expect(
      screen.queryByRole("button", { name: /Move Source of loss/ }),
    ).toBeNull();
  });
});

describe("QuickPickLabelsTab — accessible names (#857)", () => {
  it("gives the reorder, edit, and delete icon buttons accessible names", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Mine A");

    expect(screen.getByRole("button", { name: "Move Mine A up" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Move Mine A down" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit Mine A" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete Mine A" })).toBeDefined();
  });
});

// The route 403s mutations to NULL-org default rows, so an inline edit of one
// silently no-ops while still toasting success. Removing the Edit control from
// default rows (a Lock already marks them read-only) keeps the UI honest (#857).
describe("QuickPickLabelsTab — default rows are read-only (#857)", () => {
  it("renders no Edit control for shared default (NULL-org) rows", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Source of loss");

    expect(screen.queryByRole("button", { name: "Edit Source of loss" })).toBeNull();
    // org-owned rows keep their Edit control
    expect(screen.getByRole("button", { name: "Edit Mine A" })).toBeDefined();
  });
});

// The inputs cap input length to the same value the route enforces, so a user
// can't even type past the server's limit (#857).
describe("QuickPickLabelsTab — input length mirrors the server cap (#857)", () => {
  it("caps the add-label input at the server max length", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Mine A");
    fireEvent.click(screen.getByRole("button", { name: /add label/i }));

    const input = screen.getByPlaceholderText(/source of loss/i);
    expect(input.getAttribute("maxlength")).toBe(String(QUICK_PICK_LABEL_MAX_LENGTH));
  });

  it("caps the inline-edit input at the server max length", async () => {
    render(<QuickPickLabelsTab />);
    await screen.findByText("Mine A");
    fireEvent.click(screen.getByRole("button", { name: "Edit Mine A" }));

    const input = screen.getByDisplayValue("Mine A");
    expect(input.getAttribute("maxlength")).toBe(String(QUICK_PICK_LABEL_MAX_LENGTH));
  });
});
