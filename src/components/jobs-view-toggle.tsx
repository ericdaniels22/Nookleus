"use client";

import { LayoutGrid, List, Rows3 } from "lucide-react";

import type { JobsViewMode } from "@/lib/jobs/view-mode";
import { cn } from "@/lib/utils";

const OPTIONS: {
  mode: JobsViewMode;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}[] = [
  { mode: "grid", label: "Card view", Icon: LayoutGrid },
  { mode: "comfortable", label: "Comfortable view", Icon: Rows3 },
  { mode: "list", label: "List view", Icon: List },
];

/**
 * Segmented control for switching the Jobs tab view mode between Cards,
 * Comfortable, and List.
 */
export default function JobsViewToggle({
  mode,
  onChange,
}: {
  mode: JobsViewMode;
  onChange: (mode: JobsViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {OPTIONS.map(({ mode: optionMode, label, Icon }) => {
        const active = mode === optionMode;
        return (
          <button
            key={optionMode}
            type="button"
            onClick={() => onChange(optionMode)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-all",
              active
                ? "bg-[image:var(--gradient-primary)] text-white shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
