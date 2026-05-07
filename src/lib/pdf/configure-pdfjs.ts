"use client";

import { pdfjs } from "react-pdf";

let configured = false;

export function configurePdfjs() {
  if (configured) return;
  // Cache-buster: prior to the proxy.ts fix that exempts this path,
  // browsers may have cached a 307 → /login redirect for the bare URL.
  // Bumping the version forces a fresh request that the new proxy
  // matcher will pass through cleanly.
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${pdfjs.version}`;
  configured = true;
}
