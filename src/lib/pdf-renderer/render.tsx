// src/lib/pdf-renderer/render.ts — server-side render to Buffer.

import { renderToBuffer } from "@react-pdf/renderer";
import { EstimatePdf } from "@/lib/pdf-renderer/estimate-pdf";
import { InvoicePdf } from "@/lib/pdf-renderer/invoice-pdf";
import type { RenderInput } from "@/lib/pdf-renderer/types";

export async function renderPdf(input: RenderInput): Promise<Buffer> {
  if (input.kind === "estimate") {
    return renderToBuffer(<EstimatePdf {...input} />);
  }
  return renderToBuffer(<InvoicePdf {...input} />);
}
