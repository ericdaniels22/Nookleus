// Issue #543 — Estimate Builder full-width layout: integration.
//
// These tests mount the REAL EstimateBuilder in each of its three modes
// (estimate, invoice, template) and assert the document renders inside the new
// full-width BuilderLayout shell — not the old narrow, centered `max-w-4xl
// mx-auto` column — while the letterhead title and Section structure stay
// intact. They are the end-to-end proof that the shell swap reached every mode.
//
// Harness mirrors the established EstimateBuilder RTL pattern from
// estimate-drag-end.test.tsx (stub use-auto-save / next-navigation / sonner;
// real @dnd-kit so the section cards render).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type {
  BuilderEntity,
  EstimateWithContents,
  InvoiceWithContents,
  TemplateWithContents,
} from "@/lib/types";

vi.mock("./use-auto-save", () => ({
  useAutoSave: () => ({
    saveStatus: "idle",
    lastSavedAt: null,
    saveSectionsReorder: vi.fn(async () => true),
    saveLineItemsReorder: vi.fn(async () => true),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { EstimateBuilder } from "./estimate-builder";

// EstimateBuilder reads localStorage (the per-estimate template-applied flag).
// Under Node's experimental localStorage the global is a bare object missing
// getItem/setItem, so we install a functional in-memory fake on both the bare
// global and window before each mount. (This is the same Node-25 artifact that
// leaves the sibling *-drag-end suites red without a shim.)
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  const fake = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
});

// ── Minimal seeded entities (one Section with a Subsection line item, plus an
// empty Section) — enough to prove the letterhead + nested Section structure
// survive inside the new shell. ──────────────────────────────────────────────

function makeEstimateEntity(): BuilderEntity {
  const estimate: EstimateWithContents = {
    id: "est-1",
    organization_id: "org-1",
    job_id: "job-1",
    estimate_number: "EST-1",
    sequence_number: 1,
    title: "Full-width test estimate",
    status: "draft",
    opening_statement: null,
    closing_statement: null,
    subtotal: 150,
    markup_type: "none",
    markup_value: 0,
    markup_amount: 0,
    discount_type: "none",
    discount_value: 0,
    discount_amount: 0,
    adjusted_subtotal: 150,
    tax_rate: 0,
    tax_amount: 0,
    total: 150,
    issued_date: null,
    valid_until: null,
    converted_to_invoice_id: null,
    converted_at: null,
    sent_at: null,
    approved_at: null,
    rejected_at: null,
    voided_at: null,
    void_reason: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_sent_at: null,
    last_sent_to_email: null,
    deleted_at: null,
    delete_reason: null,
    pdf_layout: null,
    sections: [
      {
        id: "S1",
        organization_id: "org-1",
        estimate_id: "est-1",
        parent_section_id: null,
        title: "Roof",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [],
        subsections: [
          {
            id: "Sub1",
            organization_id: "org-1",
            estimate_id: "est-1",
            parent_section_id: "S1",
            title: "Flashing",
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            items: [
              {
                id: "X",
                organization_id: "org-1",
                estimate_id: "est-1",
                section_id: "Sub1",
                library_item_id: null,
                name: "Step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                total: 50,
                sort_order: 0,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ],
      },
    ],
  };
  return { kind: "estimate", data: estimate };
}

function makeInvoiceEntity(): BuilderEntity {
  const invoice: InvoiceWithContents = {
    id: "inv-1",
    organization_id: "org-1",
    job_id: "job-1",
    invoice_number: "INV-1",
    sequence_number: 1,
    title: "Full-width test invoice",
    status: "draft",
    issued_date: "2026-01-01T00:00:00Z",
    due_date: null,
    opening_statement: null,
    closing_statement: null,
    subtotal: 150,
    markup_type: "none",
    markup_value: 0,
    markup_amount: 0,
    discount_type: "none",
    discount_value: 0,
    discount_amount: 0,
    adjusted_subtotal: 150,
    tax_rate: 0,
    tax_amount: 0,
    total_amount: 150,
    po_number: null,
    memo: null,
    notes: null,
    converted_from_estimate_id: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    qb_invoice_id: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    last_sent_at: null,
    last_sent_to_email: null,
    deleted_at: null,
    delete_reason: null,
    pdf_layout: null,
    sections: [
      {
        id: "IS1",
        organization_id: "org-1",
        invoice_id: "inv-1",
        parent_section_id: null,
        title: "Roof",
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        items: [],
        subsections: [
          {
            id: "ISub1",
            organization_id: "org-1",
            invoice_id: "inv-1",
            parent_section_id: "IS1",
            title: "Flashing",
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            items: [
              {
                id: "IX",
                organization_id: "org-1",
                invoice_id: "inv-1",
                section_id: "ISub1",
                library_item_id: null,
                name: "Invoice step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                amount: 50,
                sort_order: 0,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
        ],
      },
    ],
  };
  return { kind: "invoice", data: invoice };
}

function makeTemplateEntity(): BuilderEntity {
  const template: TemplateWithContents = {
    id: "tmpl-1",
    organization_id: "org-1",
    name: "Full-width test template",
    description: null,
    damage_type_tags: [],
    opening_statement: null,
    closing_statement: null,
    structure: { sections: [] },
    is_active: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    sections: [
      {
        id: "TS1",
        title: "Roof",
        sort_order: 0,
        parent_section_id: null,
        items: [],
        subsections: [
          {
            id: "TSub1",
            title: "Flashing",
            sort_order: 0,
            items: [
              {
                id: "TX",
                library_item_id: null,
                name: "Template step flashing",
                description: "Install step flashing",
                note: null,
                code: null,
                quantity: 10,
                unit: null,
                unit_price: 5,
                sort_order: 0,
              },
            ],
          },
        ],
      },
    ],
  };
  return { kind: "template", data: template };
}

describe("EstimateBuilder — full-width shell across modes (#543)", () => {
  it("renders the estimate inside the full-width BuilderLayout, not a narrow centered column", () => {
    render(<EstimateBuilder entity={makeEstimateEntity()} />);

    // Letterhead title + nested Section structure remain visible/intact.
    expect(screen.getByText("Full-width test estimate")).toBeDefined();
    expect(screen.getByText("Step flashing")).toBeDefined();

    // The document lives in the full-width shell …
    expect(screen.getByTestId("builder-document")).toBeDefined();
    // … and the old narrow centered column is gone.
    expect(document.querySelector(".max-w-4xl")).toBeNull();
  });

  it("renders the invoice inside the full-width BuilderLayout, not a narrow centered column", () => {
    render(<EstimateBuilder entity={makeInvoiceEntity()} />);

    // Letterhead title + nested Section structure remain visible/intact.
    expect(screen.getByText("Full-width test invoice")).toBeDefined();
    expect(screen.getByText("Invoice step flashing")).toBeDefined();

    // The document lives in the full-width shell …
    expect(screen.getByTestId("builder-document")).toBeDefined();
    // … and the old narrow centered column is gone.
    expect(document.querySelector(".max-w-4xl")).toBeNull();
  });

  it("renders the template inside the full-width BuilderLayout, not a narrow centered column", () => {
    render(<EstimateBuilder entity={makeTemplateEntity()} />);

    // Letterhead title (template name) + nested Section structure stay intact.
    // The name surfaces in both the HeaderCard and the TemplateMetaBar, so just
    // assert it is present (at least once) — the letterhead survived the shell.
    expect(screen.getAllByText("Full-width test template").length).toBeGreaterThan(0);
    expect(screen.getByText("Template step flashing")).toBeDefined();

    // The document lives in the full-width shell …
    expect(screen.getByTestId("builder-document")).toBeDefined();
    // … and the old narrow centered column is gone.
    expect(document.querySelector(".max-w-4xl")).toBeNull();
  });
});
