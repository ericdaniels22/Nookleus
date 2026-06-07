// Component test for the shared live PDF layout panel (Estimate View #483/#484,
// Invoice View #485). The panel renders nine show/hide switches + an editable
// title over a live PDF preview: flipping a switch optimistically updates,
// debounce-saves the *complete* layout snapshot (ADR 0012) to PATCH
// /api/{estimates|invoices}/[id]/layout, and on success reloads the preview
// iframe (cache-busting query param + key remount). It is read-only on a frozen
// document (a converted estimate, or a paid/voided invoice) or without the grant.
//
// Mirrors the fetch-mock + fake-timer pattern from
// use-auto-save.flush-on-unmount.test.tsx and photo-report-defaults-tab.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The live preview is a react-pdf island (ADR 0013, #494) that never resolves in
// jsdom — the real frame only renders its "Loading document…" fallback here. Stub
// it to a lightweight element exposing the `src` the panel hands it, so the
// panel's own contract (bump to a cache-busted src after a successful save) stays
// observable through the public prop rather than through react-pdf internals.
vi.mock("@/components/documents/pdf-preview-frame", () => ({
  PdfPreviewFrame: ({ src, title }: { src: string; title: string }) => (
    <div title={title} data-src={src} />
  ),
}));

import { LiveLayoutPanel } from "./live-layout-panel";
import { toast } from "sonner";
import type { DocumentPdfLayout } from "@/lib/types";

// A complete effective layout, as the server resolves and passes in.
const EFFECTIVE_LAYOUT: DocumentPdfLayout = {
  document_title: "Estimate",
  show_document_title: true,
  show_markup: true,
  show_discount: true,
  show_tax: true,
  show_opening_statement: true,
  show_closing_statement: true,
  show_category_subtotals: false,
  show_code_column: true,
  show_item_notes: true,
};

// The nine show/hide toggles, in panel order, each paired with the accessible
// name its Label gives the switch — drives the it.each render/save matrices.
const TOGGLES: { key: keyof DocumentPdfLayout; name: RegExp }[] = [
  { key: "show_document_title", name: /show document title/i },
  { key: "show_markup", name: /show markup row in totals/i },
  { key: "show_discount", name: /show discount row in totals/i },
  { key: "show_tax", name: /show tax row in totals/i },
  { key: "show_opening_statement", name: /show opening statement/i },
  { key: "show_closing_statement", name: /show closing statement/i },
  { key: "show_category_subtotals", name: /show per-section subtotals/i },
  { key: "show_code_column", name: /show code column/i },
  { key: "show_item_notes", name: /show item notes/i },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel(over: Partial<Parameters<typeof LiveLayoutPanel>[0]> = {}) {
  return render(
    <LiveLayoutPanel
      documentType="estimate"
      documentId="est-1"
      previewSrc="/api/estimates/est-1/preview"
      previewTitle="Estimate EST-1"
      layout={{ ...EFFECTIVE_LAYOUT }}
      canEdit
      locked={false}
      {...over}
    />,
  );
}

describe("LiveLayoutPanel", () => {
  it("renders the markup toggle reflecting the effective layout (reopening restores state)", () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: false } });

    const sw = screen.getByRole("switch", { name: /show markup row in totals/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/show markup/i)).toBeDefined();
  });

  it.each(TOGGLES)(
    "renders the $key switch reflecting the effective layout (reopening restores state)",
    ({ key, name }) => {
      // Render with this one field OFF against an otherwise-on layout: a switch
      // wired to layout[key] reads false; a hardcoded/aliased switch would not.
      renderPanel({ layout: { ...EFFECTIVE_LAYOUT, [key]: false } });

      const sw = screen.getByRole("switch", { name });
      expect(sw.getAttribute("aria-checked")).toBe("false");
    },
  );

  it("renders one switch for every layout toggle (all nine present)", () => {
    renderPanel();
    expect(screen.getAllByRole("switch")).toHaveLength(TOGGLES.length);
  });

  it("autosaves the complete layout snapshot (markup flipped) via a debounced PATCH", async () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i }));

    // Debounced — no request has gone out yet.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/estimates/est-1/layout");
    expect((init as RequestInit).method).toBe("PATCH");
    // The whole snapshot is sent (seeded from the effective look) with only
    // show_markup flipped — ADR 0012 snapshot, not a partial overlay.
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, show_markup: false });
  });

  it("targets the invoice layout route when documentType is invoice (Invoice View parity, #485)", async () => {
    // Same panel, same behavior — only the PATCH target differs by document kind.
    // This is the seam #485 relies on to mount the Estimate View panel on the
    // (client-component) Invoice View.
    renderPanel({ documentType: "invoice", documentId: "inv-1" });

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/invoices/inv-1/layout");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, show_markup: false });
  });

  it.each(TOGGLES.filter((t) => t.key !== "show_markup"))(
    "flipping $key autosaves the complete snapshot with only that field changed",
    async ({ key, name }) => {
      renderPanel(); // a fully-on effective layout (subtotals off by default)

      fireEvent.click(screen.getByRole("switch", { name }));
      expect(fetchMock).not.toHaveBeenCalled(); // debounced

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // Exactly one PATCH carrying the WHOLE layout with only this field flipped —
      // the other eight toggles and the title text ride along unchanged (ADR 0012
      // snapshot, not a partial overlay).
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/estimates/est-1/layout");
      expect((init as RequestInit).method).toBe("PATCH");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toEqual({ ...EFFECTIVE_LAYOUT, [key]: !EFFECTIVE_LAYOUT[key] });
    },
  );

  it("renders the document-title text box reflecting the layout title", () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, document_title: "Proposal" } });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Proposal");
    expect(input.maxLength).toBe(200);
  });

  it("autosaves the edited title via a debounced PATCH and stays controlled", async () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, document_title: "Estimate" } });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Final Proposal" } });

    // Controlled input: the typed text is retained immediately (not reverted).
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Final Proposal",
    );
    expect(fetchMock).not.toHaveBeenCalled(); // debounced

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // One PATCH carrying the whole snapshot with the new title text; the nine
    // toggles ride along unchanged (the title travels with the document).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, document_title: "Final Proposal" });
  });

  it("coalesces rapid toggles into a single trailing PATCH carrying the final state", async () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    const sw = screen.getByRole("switch", { name: /show markup row in totals/i });
    fireEvent.click(sw); // → false
    fireEvent.click(sw); // → true   (both within the debounce window)

    // Still nothing sent — the second click cancels the first's pending timer.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Exactly one request, carrying the FINAL state (last-write-wins) — proves
    // the debounce coalesces rather than firing one PATCH per click.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, show_markup: true });
  });

  it("reloads the live preview after a successful save (cache-busting query param)", async () => {
    renderPanel();

    const before = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");
    expect(before).toBe("/api/estimates/est-1/preview");

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const after = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");
    expect(after).not.toBe(before);
    expect(after).toMatch(/[?&]v=/);
  });

  it("is read-only on a frozen (converted) estimate — switch disabled, no save", async () => {
    renderPanel({ locked: true });

    const sw = screen.getByRole("switch", { name: /show markup row in totals/i }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);

    fireEvent.click(sw);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is read-only without the edit grant — switch disabled, no save", async () => {
    renderPanel({ canEdit: false });

    const sw = screen.getByRole("switch", { name: /show markup row in totals/i }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);

    fireEvent.click(sw);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: "frozen (converted)", over: { locked: true } },
    { scenario: "without the edit grant", over: { canEdit: false } },
  ])(
    "is fully read-only $scenario — all nine switches + title box disabled, no save",
    async ({ over }) => {
      renderPanel(over);

      const switches = screen.getAllByRole("switch") as HTMLButtonElement[];
      expect(switches).toHaveLength(TOGGLES.length);
      for (const sw of switches) expect(sw.disabled).toBe(true);

      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.disabled).toBe(true);

      // Poking a switch and the title box still persists nothing.
      fireEvent.click(switches[2]);
      fireEvent.change(input, { target: { value: "Nope" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("toasts and leaves the preview untouched when the save fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);
    renderPanel();

    const before = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // No live reload on failure — the iframe keeps the last good render.
    const after = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");
    expect(after).toBe(before);
    expect(toast.error).toHaveBeenCalled();
  });

  it("rolls the toggle back to the saved look when the save fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    const sw = screen.getByRole("switch", { name: /show markup row in totals/i });
    expect(sw.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sw); // optimistic flip → false
    expect(screen.getByRole("switch", { name: /show markup row in totals/i }).getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Save failed: the switch reverts to the persisted look so it agrees with
    // the (un-reloaded) preview instead of asserting an unsaved state.
    expect(screen.getByRole("switch", { name: /show markup row in totals/i }).getAttribute("aria-checked")).toBe("true");
    expect(toast.error).toHaveBeenCalled();
  });

  it("flushes the pending save with keepalive when unmounted mid-debounce", () => {
    const { unmount } = renderPanel({
      layout: { ...EFFECTIVE_LAYOUT, show_markup: true },
    });

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i })); // schedules a debounced save
    expect(fetchMock).not.toHaveBeenCalled();

    unmount(); // navigate away within the 600ms debounce window

    // The trailing edit is flushed (keepalive) rather than silently dropped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/estimates/est-1/layout");
    expect((init as RequestInit & { keepalive?: boolean }).keepalive).toBe(true);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, show_markup: false });
  });

  it("flushes the pending save with keepalive on a hard page-unload (pagehide)", () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    fireEvent.click(screen.getByRole("switch", { name: /show markup row in totals/i })); // schedules a debounced save
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("pagehide")); // tab close / refresh / nav away
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit & {
      keepalive?: boolean;
    };
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ ...EFFECTIVE_LAYOUT, show_markup: false });
  });

  it("reloads the live preview after saving any toggle, not just markup", async () => {
    renderPanel();
    const before = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");

    fireEvent.click(screen.getByRole("switch", { name: /show tax row in totals/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const after = (
      screen.getByTitle("Estimate EST-1") as HTMLElement
    ).getAttribute("data-src");
    expect(after).not.toBe(before);
    expect(after).toMatch(/[?&]v=/);
  });

  it("rolls the title box back to the saved text when the save fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, document_title: "Estimate" } });

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bad Title" } });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Bad Title",
    ); // optimistic

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Save failed: the title box reverts to the persisted text so it agrees with
    // the un-reloaded preview, and the failure is surfaced.
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Estimate",
    );
    expect(toast.error).toHaveBeenCalled();
  });
});
