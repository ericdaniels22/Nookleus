import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OverlayField, PdfPage } from "./types";

export interface StampInput {
  sourcePdfBytes: Uint8Array;
  pdfPages: PdfPage[];
  overlayFields: OverlayField[];
  resolvedMergeValues: Record<string, string>;
  customerInputs: Record<string, string | boolean>;
  signatureDataUrls: Record<string, string>;  // keyed by signer_id (uuid)
  signerOrderById: Record<string, 1 | 2>;
  signedAt: Date;
}

const TEXT_COLOR = rgb(0, 0, 0);

export async function stampPdf(input: StampInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.sourcePdfBytes);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);

  for (const field of input.overlayFields) {
    const page = doc.getPage(field.page - 1);
    if (!page) continue;
    const pageHeight = page.getHeight();
    // Translate top-left origin (editor) → bottom-left origin (pdf-lib).
    const baselineY = pageHeight - field.y - field.height;

    switch (field.type) {
      case "merge": {
        if (!field.mergeFieldName) break;
        const value = input.resolvedMergeValues[field.mergeFieldName] ?? "";
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "date": {
        const d = input.signedAt;
        const value = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "label": {
        if (!field.labelText) break;
        drawMultilineText(page, field.labelText, field, baselineY, helvetica);
        break;
      }
      case "input": {
        if (!field.inputKey) break;
        const raw = input.customerInputs[field.inputKey];
        const value = typeof raw === "string" ? raw : "";
        drawText(page, value, field, baselineY, helvetica);
        break;
      }
      case "checkbox": {
        if (!field.inputKey) break;
        const raw = input.customerInputs[field.inputKey];
        if (raw === true) {
          // Draw a checkmark glyph centered in the box.
          const glyph = "X";
          const size = Math.min(field.width, field.height) * 0.8;
          const textWidth = helvetica.widthOfTextAtSize(glyph, size);
          page.drawText(glyph, {
            x: field.x + (field.width - textWidth) / 2,
            y: pageHeight - field.y - (field.height + size * 0.7) / 2,
            size,
            font: helvetica,
            color: TEXT_COLOR,
          });
        }
        break;
      }
      case "signature": {
        if (field.signerOrder == null) break;
        const signerId = findSignerIdByOrder(input.signerOrderById, field.signerOrder);
        if (!signerId) break;
        const dataUrl = input.signatureDataUrls[signerId];
        if (!dataUrl) break;
        const pngBytes = decodeDataUrl(dataUrl);
        if (!pngBytes) break;
        const img = await doc.embedPng(pngBytes);
        page.drawImage(img, {
          x: field.x,
          y: baselineY,
          width: field.width,
          height: field.height,
        });
        break;
      }
    }
  }

  return doc.save();
}

function drawText(
  page: ReturnType<PDFDocument["getPage"]>,
  text: string,
  field: OverlayField,
  baselineY: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  if (!text) return;
  const size = field.fontSize ?? 11;
  // Single-line: clip to the field width.
  const clipped = clipToWidth(text, field.width, size, font);
  page.drawText(clipped, {
    x: field.x,
    y: baselineY + (field.height - size) / 2,
    size,
    font,
    color: TEXT_COLOR,
  });
}

function drawMultilineText(
  page: ReturnType<PDFDocument["getPage"]>,
  text: string,
  field: OverlayField,
  baselineY: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  const size = field.fontSize ?? 11;
  const lineHeight = size * 1.2;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineText = clipToWidth(lines[i], field.width, size, font);
    const y = baselineY + field.height - (i + 1) * lineHeight;
    if (y < baselineY - lineHeight) break; // overflow stops at field bottom
    page.drawText(lineText, { x: field.x, y, size, font, color: TEXT_COLOR });
  }
}

function clipToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
): string {
  let s = text;
  while (s.length > 0 && font.widthOfTextAtSize(s, fontSize) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function findSignerIdByOrder(
  map: Record<string, 1 | 2>,
  order: 1 | 2,
): string | null {
  for (const [id, o] of Object.entries(map)) {
    if (o === order) return id;
  }
  return null;
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
