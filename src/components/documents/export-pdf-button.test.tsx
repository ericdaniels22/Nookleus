// Behavior tests for the one-click PDF export action (#487).
//
// #487 folds export onto the View and retires the standalone Export modal. The
// modal carried its own preset <select>, which could pick a look that diverged
// from the inline preview. The new button has no picker: it POSTs the pdf route
// with NO preset_id, so the route falls back to the org default preset and
// resolves the document's effective layout (ADR 0012) — byte-for-byte the look
// the preview already shows. These tests pin that parity contract.
//
// Delivery: the pdf route returns a *cross-origin* Supabase signed URL, for
// which browsers ignore <a download> and instead navigate the current tab —
// ejecting the SPA. So on desktop we open the PDF in a new tab (pre-opened
// synchronously inside the click so the popup blocker lets it through), and in
// the installed iOS app we hand it to the native Share sheet. These tests pin
// that split plus the parity / error / one-click-no-modal behavior.
//
// Mirrors the fetch-mock + sonner-stub pattern from live-layout-panel.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/share/share-or-download", () => ({
  inStandaloneApp: vi.fn(() => false),
  shareOrDownloadFile: vi.fn(() => Promise.resolve()),
}));

import { ExportPdfButton } from "./export-pdf-button";
import { toast } from "sonner";
import { inStandaloneApp, shareOrDownloadFile } from "@/lib/share/share-or-download";

let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;
let fakeTab: { location: { href: string }; close: ReturnType<typeof vi.fn>; document: { write: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inStandaloneApp).mockReturnValue(false);
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ download_url: "https://signed.example/EST-001.pdf" }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  fakeTab = { location: { href: "" }, close: vi.fn(), document: { write: vi.fn() } };
  openMock = vi.fn(() => fakeTab);
  vi.stubGlobal("open", openMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderButton(
  over: Partial<Parameters<typeof ExportPdfButton>[0]> = {},
) {
  return render(
    <ExportPdfButton
      documentType="estimate"
      documentId="est-1"
      filenameHint="EST-001"
      {...over}
    />,
  );
}

describe("ExportPdfButton (#487 one-click export)", () => {
  it("exports through the same effective layout as the preview — POSTs the pdf route with no preset_id", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/estimates/est-1/pdf");
    expect((init as RequestInit).method).toBe("POST");
    // No preset picker, no preset_id: the route falls back to the org default
    // preset — the same source the inline preview renders from (#487 parity).
    const body = JSON.parse(((init as RequestInit).body as string) || "{}");
    expect(body.preset_id).toBeUndefined();
  });

  it("on desktop, opens the signed URL in a new tab instead of navigating away", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    // Tab is pre-opened synchronously (before the await) so the popup blocker
    // lets it through, then pointed at the PDF once the route responds.
    expect(openMock).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fakeTab.location.href).toBe("https://signed.example/EST-001.pdf");
    // Desktop never touches the native Share sheet.
    expect(shareOrDownloadFile).not.toHaveBeenCalled();
  });

  it("closes the pre-opened tab and navigates nowhere when the route fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "no default preset configured" }),
    } as Response);

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(fakeTab.close).toHaveBeenCalled();
    expect(fakeTab.location.href).toBe(""); // never sent anywhere
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("in the installed app, hands the file to the Share sheet — no tab", async () => {
    vi.mocked(inStandaloneApp).mockReturnValue(true);

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(shareOrDownloadFile).toHaveBeenCalled());
    expect(shareOrDownloadFile).toHaveBeenCalledWith({
      url: "https://signed.example/EST-001.pdf",
      filename: "EST-001.pdf",
      mode: "share",
    });
    // No tab is opened inside the WebView.
    expect(openMock).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it("targets the invoice pdf route for an invoice (still no preset_id)", async () => {
    renderButton({ documentType: "invoice", documentId: "inv-1" });
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/invoices/inv-1/pdf");
    const body = JSON.parse(((init as RequestInit).body as string) || "{}");
    expect(body.preset_id).toBeUndefined();
  });

  it("is a one-click action — clicking opens no preset-picker dialog", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    // The retired modal raised a Dialog with a preset <select>; the inline
    // export must fire the request directly with no intervening picker.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
