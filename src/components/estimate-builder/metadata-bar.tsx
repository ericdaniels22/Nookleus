"use client";

import Link from "next/link";
import type { BuilderMode, Estimate, Invoice } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// MetadataBar — horizontal strip with date pickers and metadata fields.
// Mode-aware: estimate shows Issued + Valid Until; invoice shows Issued + Due
// Date + PO Number; template delegates to <TemplateMetaBar> (Task 33).
// Both date fields are disabled when the entity is voided (or paid, for invoice).
// MetadataBar is purely presentational: the parent computes auto-defaults
// before calling the onChange callbacks.
// ─────────────────────────────────────────────────────────────────────────────

interface MetadataBarProps {
  entity: Estimate | Invoice;
  onIssuedDateChange: (d: string | null) => void;
  onValidUntilChange: (d: string | null) => void;
  onDueDateChange?: (d: string | null) => void;
  onPoNumberChange?: (po: string | null) => void;
  mode?: BuilderMode;
}

export function MetadataBar({
  entity,
  onIssuedDateChange,
  onValidUntilChange,
  onDueDateChange,
  onPoNumberChange,
  mode = "estimate",
}: MetadataBarProps) {
  // Template mode delegates to <TemplateMetaBar> — see Task 33
  if (mode === "template") {
    return null;
  }

  const isVoided = entity.status === "voided";
  const isPaid = mode === "invoice" && (entity as Invoice).status === "paid";
  const isDisabled = isVoided || isPaid;

  function handleIssuedChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onIssuedDateChange(val === "" ? null : val);
  }

  function handleValidUntilChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onValidUntilChange(val === "" ? null : val);
  }

  function handleDueDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onDueDateChange?.(val === "" ? null : val);
  }

  function handlePoNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onPoNumberChange?.(val === "" ? null : val);
  }

  if (mode === "estimate") {
    const estimate = entity as Estimate;
    return (
      <div className="flex flex-row gap-6 px-4 py-3 rounded-lg border border-border/50 bg-card">
        <label className="flex flex-col gap-1 text-xs min-w-[140px]">
          <span className="uppercase tracking-wide text-muted-foreground font-medium">
            Issued date
          </span>
          <input
            type="date"
            disabled={isDisabled}
            value={estimate.issued_date ?? ""}
            onChange={handleIssuedChange}
            className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs min-w-[140px]">
          <span className="uppercase tracking-wide text-muted-foreground font-medium">
            Valid until
          </span>
          <input
            type="date"
            disabled={isDisabled}
            value={estimate.valid_until ?? ""}
            onChange={handleValidUntilChange}
            className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
          />
        </label>
      </div>
    );
  }

  // mode === "invoice"
  const invoice = entity as Invoice;
  return (
    <div className="flex flex-row gap-6 px-4 py-3 rounded-lg border border-border/50 bg-card">
      <label className="flex flex-col gap-1 text-xs min-w-[140px]">
        <span className="uppercase tracking-wide text-muted-foreground font-medium">
          Issued date
        </span>
        <input
          type="date"
          disabled={isDisabled}
          value={invoice.issued_date ?? ""}
          onChange={handleIssuedChange}
          className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs min-w-[140px]">
        <span className="uppercase tracking-wide text-muted-foreground font-medium">
          Due date
        </span>
        <input
          type="date"
          disabled={isDisabled}
          value={invoice.due_date ?? ""}
          onChange={handleDueDateChange}
          className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs min-w-[140px]">
        <span className="uppercase tracking-wide text-muted-foreground font-medium">
          PO Number
        </span>
        <input
          type="text"
          disabled={isDisabled}
          value={invoice.po_number ?? ""}
          onChange={handlePoNumberChange}
          className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </label>

      {invoice.converted_from_estimate_id && (
        <div className="flex flex-col gap-1 text-xs justify-end pb-1">
          <Link
            href={`/estimates/${invoice.converted_from_estimate_id}`}
            className="text-sm text-blue-600 hover:underline"
          >
            From estimate ↗
          </Link>
        </div>
      )}
    </div>
  );
}
