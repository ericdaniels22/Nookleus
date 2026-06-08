// Issue #518 — the platform plumbing behind the Photo viewer's Share / Save to
// device entries. Fetches the chosen image as a blob, then either opens the
// native share sheet (Web Share with a File) or downloads it, per mode and
// platform. Same recipe the contract PDF download uses; verified here against
// stubbed navigator / fetch / DOM.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { shareOrDownloadFile } from "./share-or-download";

// --- Environment stubs --------------------------------------------------------
// jsdom ships none of Web Share, object-URL minting, or matchMedia, so each test
// drives them explicitly. Defaults: a plain desktop browser tab that can fetch
// the image but has no share sheet.

let fetchMock: ReturnType<typeof vi.fn>;
let clickSpy: ReturnType<typeof vi.spyOn>;
// The `download` attribute of the anchor the last download clicked, captured off
// the spy's `this` (without aliasing the element, which eslint forbids).
let clickedDownload: string | undefined;
let origCreateObjectURL: typeof URL.createObjectURL;
let origRevokeObjectURL: typeof URL.revokeObjectURL;

function setMatchMedia(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: standalone,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

/** Install (or, with undefined, withhold) the Web Share API. */
function setWebShare(opts: {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[] }) => Promise<void>;
}) {
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    writable: true,
    value: opts.canShare,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    writable: true,
    value: opts.share,
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["bytes"], { type: "image/png" }),
  }));
  vi.stubGlobal("fetch", fetchMock);

  origCreateObjectURL = URL.createObjectURL;
  origRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();

  clickedDownload = undefined;
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      clickedDownload = this.download;
    });

  setMatchMedia(false); // desktop browser tab
  setWebShare({ canShare: undefined, share: undefined }); // no share sheet
});

afterEach(() => {
  vi.unstubAllGlobals();
  clickSpy.mockRestore();
  URL.createObjectURL = origCreateObjectURL;
  URL.revokeObjectURL = origRevokeObjectURL;
  delete (navigator as { standalone?: boolean }).standalone;
  delete (window as { Capacitor?: unknown }).Capacitor;
});

describe("shareOrDownloadFile — share mode opens the native share sheet", () => {
  it("fetches the image and shares it as a File when Web Share is available", async () => {
    const share = vi.fn<(data: { files: File[] }) => Promise<void>>(
      async () => {},
    );
    setWebShare({ canShare: () => true, share });

    await shareOrDownloadFile({
      url: "https://cdn.example/photos/job-1/IMG_1234.png",
      filename: "Kitchen before.png",
      mode: "share",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example/photos/job-1/IMG_1234.png",
    );
    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0][0];
    expect(shared.files[0]).toBeInstanceOf(File);
    expect(shared.files[0].name).toBe("Kitchen before.png");
    // Shared, not downloaded.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to a download when the Web Share API isn't available", async () => {
    // beforeEach leaves canShare / share undefined (a desktop browser tab).
    await shareOrDownloadFile({
      url: "https://cdn.example/photos/job-1/IMG_1234.png",
      filename: "Kitchen before.png",
      mode: "share",
    });

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe("Kitchen before.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("shareOrDownloadFile — save mode downloads on a desktop browser", () => {
  it("downloads rather than sharing even when a share sheet is available", async () => {
    const share = vi.fn(async () => {});
    setWebShare({ canShare: () => true, share }); // share sheet exists...
    setMatchMedia(false); // ...but this is a plain browser tab, not a PWA

    await shareOrDownloadFile({
      url: "https://cdn.example/photos/job-1/IMG_1234.jpg",
      filename: "IMG_1234.jpg",
      mode: "save",
    });

    // A desktop "Save to device" is a download — the share sheet is for where
    // the anchor download is broken (iOS PWA), not here.
    expect(share).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe("IMG_1234.jpg");
  });

  it("uses the share sheet inside a standalone PWA, where the anchor is broken", async () => {
    const share = vi.fn(async () => {});
    setWebShare({ canShare: () => true, share });
    setMatchMedia(true); // installed PWA

    await shareOrDownloadFile({
      url: "https://cdn.example/photos/job-1/IMG_1234.jpg",
      filename: "IMG_1234.jpg",
      mode: "save",
    });

    expect(share).toHaveBeenCalledOnce();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe("shareOrDownloadFile — handles share-sheet outcomes", () => {
  it("treats the user dismissing the sheet (AbortError) as a no-op", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const share = vi.fn(async () => {
      throw abort;
    });
    setWebShare({ canShare: () => true, share });

    // Must not reject, and must not silently download behind the dismissal.
    await expect(
      shareOrDownloadFile({
        url: "https://cdn.example/photos/job-1/IMG_1234.png",
        filename: "Kitchen before.png",
        mode: "share",
      }),
    ).resolves.toBeUndefined();

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("falls back to a download when the share sheet errors for real", async () => {
    const share = vi.fn(async () => {
      throw new Error("share failed");
    });
    setWebShare({ canShare: () => true, share });

    await shareOrDownloadFile({
      url: "https://cdn.example/photos/job-1/IMG_1234.png",
      filename: "Kitchen before.png",
      mode: "share",
    });

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe("Kitchen before.png");
  });

  it("rejects when the image can't be fetched", async () => {
    // A complete-looking response that merely reports failure: the helper must
    // check `ok` rather than blindly reading the body.
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: async () => new Blob(["Not found"], { type: "text/plain" }),
    });

    await expect(
      shareOrDownloadFile({
        url: "https://cdn.example/photos/job-1/missing.png",
        filename: "missing.png",
        mode: "share",
      }),
    ).rejects.toThrow();

    expect(clickSpy).not.toHaveBeenCalled();
  });
});
