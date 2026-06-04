// src/lib/estimate-status.ts — polymorphic status badge + label helpers
// for estimates and invoices.

import type { EstimateStatus } from "@/lib/types";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

export type EntityKind = "estimate" | "invoice";

// Tailwind classes for the colored pill background + text.
export const ESTIMATE_STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft:     "bg-zinc-100 text-zinc-700",
  sent:      "bg-blue-100 text-blue-700",
  approved:  "bg-emerald-100 text-emerald-700",
  rejected:  "bg-rose-100 text-rose-700",
  converted: "bg-indigo-100 text-indigo-700",
  voided:    "bg-zinc-200 text-zinc-500 line-through",
};

export const INVOICE_STATUS_BADGE_CLASSES: Record<InvoiceStatus, string> = {
  draft:   "bg-zinc-100 text-zinc-700",
  sent:    "bg-blue-100 text-blue-700",
  partial: "bg-amber-100 text-amber-700",
  paid:    "bg-emerald-100 text-emerald-700",
  voided:  "bg-zinc-200 text-zinc-500 line-through",
};

// Back-compat alias — 67a callers import this directly.
export const STATUS_BADGE_CLASSES = ESTIMATE_STATUS_BADGE_CLASSES;

export function getStatusBadgeClasses(kind: EntityKind, status: string): string {
  if (kind === "invoice") {
    return INVOICE_STATUS_BADGE_CLASSES[status as InvoiceStatus] ?? "bg-zinc-100 text-zinc-700";
  }
  return ESTIMATE_STATUS_BADGE_CLASSES[status as EstimateStatus] ?? "bg-zinc-100 text-zinc-700";
}

// ─────────────────────────────────────────────────────────────────────────────
// Row tint (#384) — extends the status helpers with the Overview row tint.
// Colour is reserved for the moments that need attention: a converted invoice
// still in draft is yellow ("ready for review"), a sent invoice is blue, and
// estimate rows plus every other invoice state are left untinted.
// ─────────────────────────────────────────────────────────────────────────────

export type RowTint = "yellow" | "blue" | "none";

export function rowTint(kind: EntityKind, status: string): RowTint {
  if (kind === "invoice") {
    if (status === "draft") return "yellow";
    if (status === "sent") return "blue";
  }
  return "none";
}

// Presentational map from semantic tint → row background class. Reuses the
// existing badge palette (amber / blue); "none" leaves the row untinted.
export const ROW_TINT_CLASSES: Record<RowTint, string> = {
  yellow: "bg-amber-50",
  blue: "bg-blue-50",
  none: "",
};

// Polymorphic label — title-cases the status string.
export function formatStatusLabel(kindOrStatus: EntityKind | string, status?: string): string {
  // Two-arg form: ("estimate" | "invoice", status)
  if (status !== undefined) {
    return titleCase(status);
  }
  // Single-arg form (back-compat for 67a callers): formatStatusLabel(status)
  return titleCase(kindOrStatus);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
