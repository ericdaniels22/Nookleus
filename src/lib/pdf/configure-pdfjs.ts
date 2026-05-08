"use client";

import { pdfjs } from "react-pdf";

let configured = false;

export function configurePdfjs() {
  if (configured) return;
  // Resolve the worker URL through the bundler. Webpack/turbopack pick up
  // the `new URL(..., import.meta.url)` pattern and emit the worker file
  // into _next/static/, which is auth-proxy-exempt and cache-busted by
  // build hash. This avoids both the /pdf.worker.min.mjs auth-proxy
  // 307→/login pitfall and the cached-redirect issue browsers have if
  // they hit the bare path before the proxy fix shipped.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  configured = true;
}
