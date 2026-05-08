// src/lib/pdf-renderer/types.ts — typed inputs for the renderer.

import type {
  PdfPreset, Estimate, Invoice, EstimateSection, EstimateLineItem,
  InvoiceSection, InvoiceLineItem,
} from "@/lib/types";

export interface PdfCompany {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
}

export interface PdfRecipient {
  name: string;
  email: string | null;
  phone: string | null;
  property_address: string | null;
}

// Discriminated union — orchestrators pick the right path based on .kind.
export type RenderInput =
  | {
      kind: "estimate";
      document: Estimate;
      sections: EstimateSection[];
      lineItems: EstimateLineItem[];
      preset: PdfPreset;
      company: PdfCompany;
      recipient: PdfRecipient;
      jobNumber: string;
    }
  | {
      kind: "invoice";
      document: Invoice;
      sections: InvoiceSection[];
      lineItems: InvoiceLineItem[];
      preset: PdfPreset;
      company: PdfCompany;
      recipient: PdfRecipient;
      jobNumber: string;
    };
