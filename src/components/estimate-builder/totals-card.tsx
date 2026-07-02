"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "./money-input";
import type { AdjustmentType, BuilderEntity, BuilderMode } from "@/lib/types";

interface TotalsCardProps {
  entity: BuilderEntity;
  /** The Overhead leg of the split Markup (#572; invoices since #575). */
  onOverheadChange: (type: AdjustmentType, value: number) => void;
  /** The Profit leg of the split Markup (#572; invoices since #575). */
  onProfitChange: (type: AdjustmentType, value: number) => void;
  onDiscountChange: (type: AdjustmentType, value: number) => void;
  onTaxRateChange: (rate: number) => void;
  readOnly?: boolean;
  mode?: BuilderMode;
  /**
   * True while the side line-item editor panel is open. The card auto-collapses
   * to its total-only pill so it never overlaps the editor, and restores the
   * user's prior expand/collapse choice once the editor closes.
   */
  editorOpen?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SummaryLine — a non-editable label + amount (Subtotal, Adjusted subtotal).
// ─────────────────────────────────────────────────────────────────────────────

function SummaryLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono tabular-nums text-foreground">
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
        <span className="text-xs font-mono tabular-nums text-foreground">
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
  onOverheadChange,
  onProfitChange,
  onDiscountChange,
  onTaxRateChange,
  readOnly = false,
  mode = "estimate",
  editorOpen = false,
}: TotalsCardProps) {
  // The floating card defaults to the full breakdown and can be collapsed to a
  // total-only pill (the pill removes the breakdown from the DOM rather than
  // CSS-hiding it, so it never covers the document lines).
  const [expanded, setExpanded] = useState(true);

  if (mode === "template" || entity.kind === "template") return null;

  // Narrow on entity.kind to read total vs total_amount; every other money
  // field — overhead/profit/discount/tax — shares its name across Estimate and
  // Invoice (#575 carried the Overhead/Profit split onto invoices).
  const totals =
    entity.kind === "invoice"
      ? {
          subtotal: entity.data.subtotal,
          overhead_type: entity.data.overhead_type,
          overhead_value: entity.data.overhead_value,
          overhead_amount: entity.data.overhead_amount,
          profit_type: entity.data.profit_type,
          profit_value: entity.data.profit_value,
          profit_amount: entity.data.profit_amount,
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
          overhead_type: entity.data.overhead_type,
          overhead_value: entity.data.overhead_value,
          overhead_amount: entity.data.overhead_amount,
          profit_type: entity.data.profit_type,
          profit_value: entity.data.profit_value,
          profit_amount: entity.data.profit_amount,
          discount_type: entity.data.discount_type,
          discount_value: entity.data.discount_value,
          discount_amount: entity.data.discount_amount,
          adjusted_subtotal: entity.data.adjusted_subtotal,
          tax_rate: entity.data.tax_rate,
          tax_amount: entity.data.tax_amount,
          total: entity.data.total,
        };

  const isNegative = totals.total < 0;

  // Derived at render: the card shows its full breakdown only when the user
  // has it expanded AND the side line-item editor is closed. This makes the
  // editor-open auto-collapse (and the restore-on-close) fall out for free —
  // `expanded` is never mutated by the editor, so closing it returns the card
  // to whatever the user last chose.
  const showExpanded = expanded && !editorOpen;

  return (
    <div
      data-testid="totals-card"
      className="fixed bottom-4 right-4 z-30 w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        {/* Breakdown — present only when expanded (pill removes it from DOM). */}
        {showExpanded && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <SummaryLine label="Subtotal" amount={totals.subtotal} />
            {/* #572/#575 — the Markup is two independent uplifts, Overhead and
                Profit, each off the raw Subtotal — on estimates AND invoices. */}
            <AdjustmentRow
              label="Overhead"
              type={totals.overhead_type}
              value={totals.overhead_value}
              amount={totals.overhead_amount}
              onChange={onOverheadChange}
              readOnly={readOnly}
            />
            <AdjustmentRow
              label="Profit"
              type={totals.profit_type}
              value={totals.profit_value}
              amount={totals.profit_amount}
              onChange={onProfitChange}
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
            <SummaryLine
              label="Adjusted subtotal"
              amount={totals.adjusted_subtotal}
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs text-muted-foreground">Tax</span>
                <span className="text-xs font-mono tabular-nums text-foreground">
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
        )}

        {/* Compact summary — always shows the grand Total. The expand toggle is
            withheld while the editor is open, so the card stays a pill. */}
        <div className="flex items-center justify-between gap-3">
          {editorOpen ? (
            <span />
          ) : (
            <button
              type="button"
              aria-expanded={showExpanded}
              aria-label="Totals breakdown"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              <span>{showExpanded ? "Hide" : "Details"}</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Total</span>
            <span
              className={`text-sm font-semibold font-mono tabular-nums ${
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
