import type { CollectionRing as CollectionRingState } from "./financials-view-model";
import type { RingGeometry } from "./ring-geometry";
import { fmtCurrency } from "./format-currency";

// Presentational only — which state to show, the ring geometry, and the
// numbers are all decided by the view-model deriver; this just lays them out.
// The ring is a hand-rolled SVG arc, deliberately no charting dependency.
// Colors are design tokens: the fill/paid-ahead accent is --primary (the §2.7
// chart-1 emerald), the track is --border, and the panel is a raised muted
// surface (§2.1). Paid-ahead is good news, not a maxed-out bill, so it takes
// the same positive accent as the ring fill.
export default function CollectionRing({ ring }: { ring: CollectionRingState }) {
  // Nothing billed yet (deposits before billing) — no ring, just the total.
  if (ring.kind === "not-invoiced-yet") {
    return (
      <div className="rounded-lg border border-border-subtle bg-muted/40 p-4">
        <span className="text-sm text-foreground">Collected {fmtCurrency(ring.collected)}</span>
        <span className="ml-1 text-xs text-muted-foreground">· not invoiced yet</span>
      </div>
    );
  }

  // collection-rate | paid-ahead — both paint a ring. collection-rate shows the
  // Outstanding still owed; paid-ahead (Collected > Invoiced) shows the
  // good-news over-amount instead.
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-subtle bg-muted/40 p-4">
      <RingArc geometry={ring.geometry} />
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Collected</div>
        <div className="text-lg font-semibold text-foreground tabular-nums">
          {fmtCurrency(ring.collected)}
        </div>
        {ring.kind === "collection-rate" && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span>Outstanding</span>{" "}
            <span className="tabular-nums">{fmtCurrency(ring.outstanding)}</span>
          </div>
        )}
        {ring.kind === "paid-ahead" && (
          <div className="mt-0.5 text-xs">
            <span className="text-primary">Paid ahead</span>{" "}
            <span className="tabular-nums text-primary">
              {fmtCurrency(ring.overCollected)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const STROKE = 8;

function RingArc({ geometry }: { geometry: RingGeometry }) {
  // The stroke straddles the radius, so the box must clear half a stroke on
  // each side for the arc not to clip.
  const size = (geometry.radius + STROKE / 2) * 2;
  const c = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${geometry.percent}% collected`}
      className="shrink-0"
    >
      {/* unfilled track */}
      <circle
        cx={c}
        cy={c}
        r={geometry.radius}
        fill="none"
        className="stroke-border"
        strokeWidth={STROKE}
      />
      {/* progress arc — rotated to start at 12 o'clock and fill clockwise */}
      <circle
        cx={c}
        cy={c}
        r={geometry.radius}
        fill="none"
        className="stroke-primary"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={geometry.dashArray}
        strokeDashoffset={geometry.dashOffset}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <text
        x={c}
        y={c}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-sm font-semibold"
      >
        {geometry.percent}%
      </text>
    </svg>
  );
}
