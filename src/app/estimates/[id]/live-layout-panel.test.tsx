// Component test for the live single-toggle layout panel on the Estimate View
// (#483). The panel renders one "Show markup" switch over a live PDF preview:
// flipping the switch optimistically updates, debounce-saves the *complete*
// layout snapshot (ADR 0012) to PATCH /api/estimates/[id]/layout, and on success
// reloads the preview iframe (cache-busting query param + key remount). It is
// read-only on a frozen (converted) estimate.
//
// Mirrors the fetch-mock + fake-timer pattern from
// use-auto-save.flush-on-unmount.test.tsx and photo-report-defaults-tab.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
      estimateId="est-1"
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

    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/show markup/i)).toBeDefined();
  });

  it("autosaves the complete layout snapshot (markup flipped) via a debounced PATCH", async () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    fireEvent.click(screen.getByRole("switch"));

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

  it("coalesces rapid toggles into a single trailing PATCH carrying the final state", async () => {
    renderPanel({ layout: { ...EFFECTIVE_LAYOUT, show_markup: true } });

    const sw = screen.getByRole("switch");
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
      screen.getByTitle("Estimate EST-1") as HTMLIFrameElement
    ).getAttribute("src");
    expect(before).toBe("/api/estimates/est-1/preview");

    fireEvent.click(screen.getByRole("switch"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const after = (
      screen.getByTitle("Estimate EST-1") as HTMLIFrameElement
    ).getAttribute("src");
    expect(after).not.toBe(before);
    expect(after).toMatch(/[?&]v=/);
  });

  it("is read-only on a frozen (converted) estimate — switch disabled, no save", async () => {
    renderPanel({ locked: true });

    const sw = screen.getByRole("switch") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);

    fireEvent.click(sw);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is read-only without the edit grant — switch disabled, no save", async () => {
    renderPanel({ canEdit: false });

    const sw = screen.getByRole("switch") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);

    fireEvent.click(sw);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("toasts and leaves the preview untouched when the save fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    } as Response);
    renderPanel();

    const before = (
      screen.getByTitle("Estimate EST-1") as HTMLIFrameElement
    ).getAttribute("src");

    fireEvent.click(screen.getByRole("switch"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // No live reload on failure — the iframe keeps the last good render.
    const after = (
      screen.getByTitle("Estimate EST-1") as HTMLIFrameElement
    ).getAttribute("src");
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

    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(sw); // optimistic flip → false
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Save failed: the switch reverts to the persisted look so it agrees with
    // the (un-reloaded) preview instead of asserting an unsaved state.
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(toast.error).toHaveBeenCalled();
  });

  it("flushes the pending save with keepalive when unmounted mid-debounce", () => {
    const { unmount } = renderPanel({
      layout: { ...EFFECTIVE_LAYOUT, show_markup: true },
    });

    fireEvent.click(screen.getByRole("switch")); // schedules a debounced save
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

    fireEvent.click(screen.getByRole("switch")); // schedules a debounced save
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
});
