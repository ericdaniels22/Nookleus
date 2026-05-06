"use client";

import { pdfjs } from "react-pdf";

let configured = false;

export function configurePdfjs() {
  if (configured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  configured = true;
}
