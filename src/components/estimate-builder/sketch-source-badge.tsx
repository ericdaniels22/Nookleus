// The little chip that marks a line item whose `quantity` was pulled — and
// frozen — from a Sketch (#861, S2 "money slice"; #865 grows it to Floor and
// whole-Sketch scope). It reads the frozen `sketch_source` breadcrumb (ADR 0004 —
// a snapshot, not a live link) and names the source scope and measurement kind so
// the reader knows exactly where the billed number came from, even after the
// Sketch is edited or the Room/Floor renamed.

import { Ruler } from "lucide-react";

import {
  sketchSourceKindLabel,
  sketchSourceLabel,
  type SketchSource,
} from "@/lib/sketch/pull-resolver";

export function SketchSourceBadge({ source }: { source: SketchSource }) {
  const kindLabel = sketchSourceKindLabel(source);
  const sourceLabel = sketchSourceLabel(source);
  return (
    <span
      data-testid="sketch-source-badge"
      title={`Pulled from Sketch — ${sourceLabel} · ${kindLabel}`}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
    >
      <Ruler className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {sourceLabel} · {kindLabel}
      </span>
    </span>
  );
}
