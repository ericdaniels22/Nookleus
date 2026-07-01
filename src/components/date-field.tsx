"use client";

import { useEffect, useRef, useState } from "react";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfToday,
  subMonths,
} from "date-fns";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isValidPastDate, maskDateInput, parseMaskedDate } from "@/lib/date-field";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

/**
 * Masked MM/DD/YYYY text input paired with a hand-rolled month-grid calendar
 * popover. Future dates are rejected: the calendar disables future days, and a
 * complete typed value that is in the future (or non-existent) is flagged.
 */
export function DateField({ value, onChange, placeholder, id }: DateFieldProps) {
  const today = startOfToday();
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(pastOrToday(parseMaskedDate(value), today)),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = parseMaskedDate(value);
  const complete = value.length === 10;
  const invalidMessage =
    !complete || isValidPastDate(value)
      ? null
      : !selected
        ? "Enter a real calendar date."
        : "The date can’t be in the future.";

  function toggleCalendar() {
    setViewMonth(startOfMonth(pastOrToday(parseMaskedDate(value), today)));
    setOpen((o) => !o);
  }

  function pickDay(day: Date) {
    onChange(format(day, "MM/dd/yyyy"));
    setOpen(false);
  }

  const monthStart = startOfMonth(viewMonth);
  const cells: (Date | null)[] = [
    ...Array<null>(getDay(monthStart)).fill(null),
    ...Array.from(
      { length: getDaysInMonth(viewMonth) },
      (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1),
    ),
  ];
  const canGoNext = !isSameMonth(viewMonth, today);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(maskDateInput(e.target.value))}
          placeholder={placeholder || "MM/DD/YYYY"}
          aria-invalid={invalidMessage ? true : undefined}
          className="pr-9"
        />
        <button
          type="button"
          onClick={toggleCalendar}
          aria-label="Open calendar"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <CalendarIcon className="size-4" />
        </button>
      </div>

      {invalidMessage && <p className="mt-1 text-xs text-destructive">{invalidMessage}</p>}

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-[17rem] rounded-lg border border-border bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              aria-label="Previous month"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span className="text-sm font-semibold text-foreground">
              {format(viewMonth, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => canGoNext && setViewMonth((m) => addMonths(m, 1))}
              disabled={!canGoNext}
              aria-label="Next month"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((wd) => (
              <div
                key={wd}
                className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground"
              >
                {wd}
              </div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`blank-${i}`} className="size-8" />;
              const isFuture = isAfter(day, today);
              const isSelected = !!selected && isSameDay(day, selected);
              const isToday = isSameDay(day, today);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={isFuture}
                  onClick={() => pickDay(day)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-sm transition-colors",
                    isFuture && "cursor-not-allowed text-muted-foreground/30",
                    !isFuture && !isSelected && "text-foreground hover:bg-accent",
                    isSelected && "bg-primary font-semibold text-primary-foreground",
                    isToday && !isSelected && "font-semibold ring-1 ring-inset ring-[var(--brand-primary)]/40",
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** The given date when it exists and is not in the future, otherwise `today`. */
function pastOrToday(date: Date | null, today: Date): Date {
  return date && !isAfter(date, today) ? date : today;
}
