// src/lib/estimate-status.ts — polymorphic status badge + label helpers
// for estimates and invoices.

import type { EstimateStatus } from "@/lib/types";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

export type EntityKind = "estimate" | "invoice";

// Tailwind classes for the colored pill background + text.
export const ESTIMATE_STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft:     "bg-zinc-100 text-zinc-700",
  sent:      "bg-blue-100 text-blue-700",
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

export function getStatusBadgeClasses(kind: EntityKind, status: string): string {
  if (kind === "invoice") {
    return INVOICE_STATUS_BADGE_CLASSES[status as InvoiceStatus] ?? "bg-zinc-100 text-zinc-700";
  }
  return ESTIMATE_STATUS_BADGE_CLASSES[status as EstimateStatus] ?? "bg-zinc-100 text-zinc-700";
}

// ─────────────────────────────────────────────────────────────────────────────
// Estimate status transitions (#567) — the pure state-machine, extracted out of
// the PUT /api/estimates/[id]/status route so it can be unit-tested in isolation
// and shared. The workflow is exactly draft → sent → converted / voided, per
// ADR 0007; the old approved/rejected step is gone. Convert is its own action
// (POST /convert) that flips the row to `converted`, so it is NOT a status
// transition here and nothing leads *to* `converted`.
// ─────────────────────────────────────────────────────────────────────────────

export const ESTIMATE_STATUS_TRANSITIONS: Partial<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent", "voided"],
  sent: ["voided"],
  converted: [], // terminal
  voided: [], // terminal
};

// True iff `to` is a legal next status from `from`. An unknown `from` (e.g. a
// legacy `approved`/`rejected` row that predates the #567 migration) is treated
// as terminal rather than throwing.
export function canTransitionEstimate(from: EstimateStatus, to: EstimateStatus): boolean {
  return (ESTIMATE_STATUS_TRANSITIONS[from] ?? []).includes(to);
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
