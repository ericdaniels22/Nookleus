// The little chip that marks a line item whose `quantity` was pulled — and
// frozen — from a Sketch Room (#861, S2 "money slice"). It reads the frozen
// `sketch_source` breadcrumb (ADR 0004 — a snapshot, not a live link) and names
// the source Room and the measurement kind so the reader knows exactly where the
// billed number came from, even after the Sketch is edited or the Room renamed.

import { Ruler } from "lucide-react";

import {
  ROOM_MEASUREMENT_KIND_LABELS,
  type SketchSource,
} from "@/lib/sketch/pull-resolver";

export function SketchSourceBadge({ source }: { source: SketchSource }) {
  const kindLabel = ROOM_MEASUREMENT_KIND_LABELS[source.kind];
  return (
    <span
      data-testid="sketch-source-badge"
      title={`Pulled from Sketch — ${source.room_name} · ${kindLabel}`}
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
    >
      <Ruler className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {source.room_name} · {kindLabel}
      </span>
    </span>
  );
}
