// Reorder behavior for the Settings → Photos → Quick-pick labels tab (#856).
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
