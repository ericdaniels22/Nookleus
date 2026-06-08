// Issue #518 — fetch an image and hand it to the device: open the native share
// sheet (Web Share with a File) or download it. The same recipe the contract
// PDF download uses, extracted so the Photo viewer's Share / Save to device
// entries can reuse it. Kept as a plain async function (reads browser globals at
// call time) so it's driven from one tested place.

/** How the caller wants the file delivered. */
export type ShareMode = "share" | "save";

export interface ShareOrDownloadOptions {
  /** URL of the already-resolved version to deliver (see exportVersion). */
  url: string;
  /** The name the delivered file should carry. */
  filename: string;
  /** `share` prefers the share sheet; `save` downloads (sheet only where the
   *  download anchor is broken — iOS PWA / Capacitor). */
  mode: ShareMode;
}

export async function shareOrDownloadFile({
  url,
  filename,
  mode,
}: ShareOrDownloadOptions): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });

  // Share always prefers the sheet; Save downloads, reaching for the sheet only
  // inside an installed shell where the <a download> anchor silently fails.
  const preferShare =
    mode === "share" ? canShareFile(file) : inStandaloneApp() && canShareFile(file);

  if (preferShare) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // The user dismissing the sheet isn't a failure — nothing more to do. A
      // real share error still owes the user the file, so fall through to the
      // download.
      if ((err as DOMException)?.name === "AbortError") return;
    }
  }

  downloadBlob(blob, filename);
}

/** Whether the device can share this file through the Web Share API. */
function canShareFile(file: File): boolean {
  return navigator.canShare?.({ files: [file] }) === true;
}

/**
 * Whether we're running inside an installed shell — a standalone PWA, an iOS
 * Add-to-Home-Screen page, or a Capacitor WKWebView — where tapping a download
 * anchor navigates the SPA to the file instead of saving it.
 */
function inStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as Window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    cap?.isNativePlatform?.() === true
  );
}

/** Save a blob to disk via a synthetic, self-cleaning download anchor. */
function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
