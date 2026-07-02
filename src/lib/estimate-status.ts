// src/lib/estimate-status.ts — polymorphic status badge + label helpers
// for estimates and invoices.

import type { EstimateStatus } from "@/lib/types";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

export type EntityKind = "estimate" | "invoice";

// Tailwind classes for the colored pill background + text — the §2.6
// dark-tint treatment (#929): a ~14%-alpha wash of the status hue behind
// colored text, never a solid light fill. Hue choices mirror the payment
// badges in badge-colors.ts (sent = sky, partial = amber/warning,
// paid = emerald/success); draft and voided are the neutral pairs.
export const ESTIMATE_STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft:     "bg-white/7 text-text-secondary",
  sent:      "bg-sky-400/14 text-sky-300",
  converted: "bg-indigo-400/14 text-indigo-300",
  voided:    "bg-white/5 text-muted-foreground line-through",
};

export const INVOICE_STATUS_BADGE_CLASSES: Record<InvoiceStatus, string> = {
  draft:   "bg-white/7 text-text-secondary",
  sent:    "bg-sky-400/14 text-sky-300",
  partial: "bg-amber-400/14 text-amber-400",
  paid:    "bg-emerald-500/14 text-emerald-300",
  voided:  "bg-white/5 text-muted-foreground line-through",
};

export function getStatusBadgeClasses(kind: EntityKind, status: string): string {
  if (kind === "invoice") {
    return INVOICE_STATUS_BADGE_CLASSES[status as InvoiceStatus] ?? "bg-white/7 text-text-secondary";
  }
  return ESTIMATE_STATUS_BADGE_CLASSES[status as EstimateStatus] ?? "bg-white/7 text-text-secondary";
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
// badge hues (amber / sky) at a lower alpha — a row wash sits under a whole
// line of text, so it stays quieter than the 14% pill tint (#929).
export const ROW_TINT_CLASSES: Record<RowTint, string> = {
  yellow: "bg-amber-400/8",
  blue: "bg-sky-400/8",
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
