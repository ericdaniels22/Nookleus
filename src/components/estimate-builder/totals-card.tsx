"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "./money-input";
import type { AdjustmentType, BuilderEntity, BuilderMode } from "@/lib/types";

interface TotalsCardProps {
  entity: BuilderEntity;
  onMarkupChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
  mode?: BuilderMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// SummaryLine — a non-editable label + amount (Subtotal, Adjusted subtotal).
// ─────────────────────────────────────────────────────────────────────────────

function SummaryLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono text-foreground">
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdjustmentToggle — 3-button group for % / $ / none
// ─────────────────────────────────────────────────────────────────────────────

function AdjustmentToggle({
  type,
  value,
  onChange,
  disabled,
}: {
  type: AdjustmentType;
  value: number;
  onChange: (type: AdjustmentType, value: number) => void;
  disabled: boolean;
}) {
  const btn =
    "px-1.5 py-0.5 rounded text-xs font-medium transition-colors leading-tight";
  const active = "bg-primary text-primary-foreground";
  const inactive = "text-muted-foreground hover:text-foreground hover:bg-muted";

  return (
    <div className="flex gap-0.5 rounded border border-border p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("percent", value)}
        className={`${btn} ${type === "percent" ? active : inactive}`}
        title="Percent"
      >
        %
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("amount", value)}
        className={`${btn} ${type === "amount" ? active : inactive}`}
        title="Fixed amount"
      >
        $
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("none", 0)}
        className={`${btn} ${type === "none" ? active : inactive}`}
        title="None"
      >
        —
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdjustmentRow — computed amount on top, toggle + value input below. The
// fixed-amount variant uses the $-prefixed MoneyInput (#542); percent (and the
// disabled "none") use a plain number box. Tax keeps its own % box (below).
// ─────────────────────────────────────────────────────────────────────────────

function AdjustmentRow({
  label,
  type,
  value,
  amount,
  onChange,
  readOnly,
  isDiscount,
}: {
  label: string;
  type: AdjustmentType;
  value: number;
  amount: number;
  onChange: (type: AdjustmentType, value: number) => void;
  readOnly: boolean;
  isDiscount?: boolean;
}) {
  const isNone = type === "none";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-foreground">
          {isNone
            ? "—"
            : isDiscount
            ? `−${formatCurrency(amount)}`
            : formatCurrency(amount)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <AdjustmentToggle
          type={type}
          value={value}
          onChange={onChange}
          disabled={readOnly}
        />
        {type === "amount" ? (
          <MoneyInput
            value={value}
            onCommit={(n) => onChange("amount", n)}
            readOnly={readOnly}
            placeholder="0.00"
            className="h-6 flex-1 min-w-0 rounded-lg border border-input px-1.5 text-xs focus-within:border-primary"
          />
        ) : (
          <Input
            type="number"
            min={0}
            step={0.01}
            value={isNone ? "" : value}
            disabled={readOnly || isNone}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (!isNaN(n) && n >= 0) onChange(type, n);
            }}
            className="h-6 text-xs px-1.5 flex-1 min-w-0"
            placeholder={isNone ? "—" : type === "percent" ? "0" : "0.00"}
          />
        )}
      </div>
    </div>
  );
}

export function TotalsCard({
  entity,
  onMarkupChange,
  onDiscountChange,
  onTaxRateChange,
  readOnly = false,
  mode = "estimate",
}: TotalsCardProps) {
  // Phone: the bar is compact (grand Total only) and taps open to reveal the
  // breakdown so it never covers the document lines. Desktop always shows the
  // full row (the `lg:` classes below force it regardless of this state).
  const [expanded, setExpanded] = useState(false);

  if (mode === "template" || entity.kind === "template") return null;

  // Narrow on entity.kind to read total vs total_amount; every other monetary
  // field shares its name across Estimate and Invoice.
  const totals =
    entity.kind === "invoice"
      ? {
          subtotal: entity.data.subtotal,
          markup_type: entity.data.markup_type,
          markup_value: entity.data.markup_value,
          markup_amount: entity.data.markup_amount,
          discount_type: entity.data.discount_type,
          discount_value: entity.data.discount_value,
          discount_amount: entity.data.discount_amount,
          adjusted_subtotal: entity.data.adjusted_subtotal,
          tax_rate: entity.data.tax_rate,
          tax_amount: entity.data.tax_amount,
          total: entity.data.total_amount,
        }
      : {
          subtotal: entity.data.subtotal,
          markup_type: entity.data.markup_type,
          markup_value: entity.data.markup_value,
          markup_amount: entity.data.markup_amount,
          discount_type: entity.data.discount_type,
          discount_value: entity.data.discount_value,
          discount_amount: entity.data.discount_amount,
          adjusted_subtotal: entity.data.adjusted_subtotal,
          tax_rate: entity.data.tax_rate,
          tax_amount: entity.data.tax_amount,
          total: entity.data.total,
        };

  const isNegative = totals.total < 0;

  return (
    <div className="sticky bottom-0 z-20 w-full border-t border-border bg-card shadow-[0_-1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex flex-col gap-2 px-4 py-2 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        {/* Breakdown — collapsible on phone, always inline on desktop. */}
        <div
          className={`${
            expanded ? "grid" : "hidden"
          } grid-cols-2 gap-x-4 gap-y-2 lg:flex lg:flex-1 lg:flex-wrap lg:items-end lg:gap-x-6 lg:gap-y-2`}
        >
          <SummaryLine label="Subtotal" amount={totals.subtotal} />
          <AdjustmentRow
            label="Markup"
            type={totals.markup_type}
            value={totals.markup_value}
            amount={totals.markup_amount}
            onChange={onMarkupChange}
            readOnly={readOnly}
          />
          <AdjustmentRow
            label="Discount"
            type={totals.discount_type}
            value={totals.discount_value}
            amount={totals.discount_amount}
            onChange={onDiscountChange}
            readOnly={readOnly}
            isDiscount
          />
          <SummaryLine label="Adjusted subtotal" amount={totals.adjusted_subtotal} />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Tax</span>
              <span className="text-xs font-mono text-foreground">
                {formatCurrency(totals.tax_amount)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={totals.tax_rate}
                disabled={readOnly}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) onTaxRateChange(n);
                }}
                className="h-6 text-xs px-1.5 w-16 flex-none"
                placeholder="0"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        {/* Compact summary — always visible: phone expand toggle + grand Total. */}
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label="Totals breakdown"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground lg:hidden"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            <span>Details</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Total</span>
            <span
              className={`text-sm font-semibold font-mono ${
                isNegative ? "text-destructive" : "text-foreground"
              }`}
            >
              {formatCurrency(totals.total)}
            </span>
          </div>
        </div>
      </div>

      {isNegative && (
        <div className="flex items-center gap-1 px-4 pb-2 text-xs text-muted-foreground">
          <AlertTriangle size={12} className="text-destructive" />
          <span>Negative total</span>
        </div>
      )}
    </div>
  );
}
