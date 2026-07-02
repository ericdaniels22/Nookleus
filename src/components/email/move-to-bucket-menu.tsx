"use client";

import { useState, useRef, useEffect } from "react";
import { FolderInput } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/email-categorizer";

/**
 * Move-to-bucket affordance (#957): a small button that opens a popover of the
 * file-able buckets. Used from the list row, the reader header, and the bulk
 * bar. Closes on outside click and stops click propagation so it can live
 * inside a clickable email row without also opening the reader.
 */
export default function MoveToBucketMenu({
  onMove,
  currentCategory,
  disabled,
  size = 16,
  align = "right",
}: {
  onMove: (category: Category) => void;
  /** The email's current bucket, disabled in the list as a no-op target. */
  currentCategory?: string | null;
  disabled?: boolean;
  size?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={disabled}
        title="Move to bucket"
        className="p-1.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-50"
      >
        <FolderInput size={size} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute ${
            align === "right" ? "right-0" : "left-0"
          } top-full mt-1 w-44 bg-popover border border-border rounded-lg shadow-lg z-30 p-1`}
        >
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Move to
          </p>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              disabled={cat === currentCategory}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onMove(cat);
              }}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent text-foreground"
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
