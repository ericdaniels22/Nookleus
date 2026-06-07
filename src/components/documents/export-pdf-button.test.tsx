// Behavior tests for the one-click PDF export action (#487).
//
// #487 folds export onto the View and retires the standalone Export modal. The
// modal carried its own preset <select>, which could pick a look that diverged
// from the inline preview. The new button has no picker: it POSTs the pdf route
// with NO preset_id, so the route falls back to the org default preset and
// resolves the document's effective layout (ADR 0012) — byte-for-byte the look
// the preview already shows. These tests pin that parity contract plus the
// download / error / one-click-no-modal behavior.
//
// Mirrors the fetch-mock + sonner-stub pattern from live-layout-panel.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ExportPdfButton } from "./export-pdf-button";
import { toast } from "sonner";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ download_url: "https://signed.example/EST-001.pdf" }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
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

  it("downloads the returned signed URL as <filenameHint>.pdf on success", async () => {
    let downloadedHref = "";
    let downloadName = "";
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedHref = this.href;
        downloadName = this.download;
      });

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    expect(downloadedHref).toBe("https://signed.example/EST-001.pdf");
    expect(downloadName).toBe("EST-001.pdf");
    expect(toast.success).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("surfaces an error and triggers no download when the route fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "no default preset configured" }),
    } as Response);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(clickSpy).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    clickSpy.mockRestore();
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
