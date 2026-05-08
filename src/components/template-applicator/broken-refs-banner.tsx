"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

export interface BrokenRefsBannerProps {
  estimateId: string;
  brokenRefs: Array<{
    section_idx: number;
    item_idx: number;
    library_item_id: string | null;
    placeholder: boolean;
    in_subsection?: boolean;
    subsection_idx?: number;
  }>;
  // Optional callback to scroll to a specific item by its position in the entity tree.
  onScrollToItem?: (sectionIdx: number, subsectionIdx: number | undefined, itemIdx: number) => void;
}

export default function BrokenRefsBanner({ estimateId, brokenRefs, onScrollToItem }: BrokenRefsBannerProps) {
  const dismissedKey = `nookleus.broken-refs-dismissed.${estimateId}`;
  const [dismissed, setDismissed] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem(dismissedKey) === "1");
  const [expanded, setExpanded] = useState(false);

  if (dismissed || brokenRefs.length === 0) return null;

  function handleDismiss() {
    if (typeof window !== "undefined") localStorage.setItem(dismissedKey, "1");
    setDismissed(true);
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4">
      <div className="flex items-center gap-2 text-sm">
        <span>⚠ <strong>{brokenRefs.length} items reference inactive library entries.</strong></span>
        <span className="text-muted-foreground">Edit them or replace before sending.</span>
        <button onClick={() => setExpanded(!expanded)} className="ml-auto text-sm flex items-center gap-1">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Show items
        </button>
        <button onClick={handleDismiss} aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1 text-sm">
          {brokenRefs.map((r, i) => (
            <li key={i} className="cursor-pointer hover:underline" onClick={() => onScrollToItem?.(r.section_idx, r.subsection_idx, r.item_idx)}>
              Section {r.section_idx + 1}{r.in_subsection ? ` → Subsection ${(r.subsection_idx ?? 0) + 1}` : ""} → Item {r.item_idx + 1}
              {r.placeholder ? " (placeholder)" : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
