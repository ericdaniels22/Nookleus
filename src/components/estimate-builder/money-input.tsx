"use client";

// MoneyInput (#542) — a $-prefixed numeric box for entering dollar amounts in
// the Estimate Builder (line-item unit cost, fixed-dollar Markup/Discount).
//
// The `$` is a static visual prefix. The box holds the raw typed string while
// editing and parses to a number only at the edges (on commit). It never
// reformats mid-type — no comma insertion that would fight the caret. The
// already-formatted total (e.g. $1,375.00) is shown by the consumer beside it.
//
// The two consumers style their box very differently (borderless inline cell in
// the line-item row vs. a small bordered box in the totals panel), so the visual
// treatment is passed in via `className` on the wrapper. MoneyInput owns only the
// `$` adornment and the draft/commit behavior.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface MoneyInputProps {
  value: number;
  onCommit: (n: number) => void;
  /** Fired with the raw typed string on each keystroke — lets a consumer keep a
   *  running total ticking live without waiting for commit. */
  onValueChange?: (raw: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** Visual treatment for the wrapper (border, width, padding, alignment). */
  className?: string;
}

export function MoneyInput({
  value,
  onCommit,
  onValueChange,
  readOnly,
  placeholder,
  className,
}: MoneyInputProps) {
  const [draft, setDraft] = useState(String(value));

  // Resync from the prop when the value changes from outside (server reconcile,
  // or normalization of the committed number). Does not fire mid-type because
  // the parent's value only changes on commit, not on each keystroke.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) {
      onCommit(parsed);
    } else {
      // Empty or non-numeric — reject and snap the box back to the last value.
      setDraft(String(value));
    }
  }

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <span className="shrink-0 select-none text-muted-foreground">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => {
          setDraft(e.target.value);
          onValueChange?.(e.target.value);
        }}
        onBlur={readOnly ? undefined : commit}
        className="min-w-0 flex-1 border-0 bg-transparent text-right tabular-nums outline-none ring-0 placeholder:text-muted-foreground/50"
      />
    </span>
  );
}
