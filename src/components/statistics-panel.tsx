// Issue #865 — Sketch S5: the Statistics panel. Pure presentation over the M2
// roll-up (aggregate.ts): the active Floor's totals beside the whole-Sketch
// totals. "Surface area" is the summed floor area — the MagicPlan headline the
// PRD asks for — shown with volume and the room / door / window counts. The
// numbers are computed and unit-tested upstream (aggregate.ts / room-stats.ts);
// this only lays them out.

import type { ReactNode } from "react";

import type { SketchAggregate } from "@/lib/sketch/aggregate";

/** Trim trailing zeros so "420.000" reads as "420" but "12.5" survives. */
function fmt(value: number): string {
  return Number(Number(value).toFixed(3)).toString();
}

interface StatisticsPanelProps {
  /** The active Floor's totals — the summed measurements of its Rooms. */
  floor: SketchAggregate;
  /** The whole-Sketch totals — every Floor summed. */
  sketch: SketchAggregate;
  /** The active Floor's name, for the section heading. */
  floorName?: string;
}

// One scope's block of stats — the same six figures for a Floor and for the
// whole Sketch. `scope` prefixes the test ids ("floor" / "sketch") so each
// block's figures are addressable on their own.
function StatBlock({
  scope,
  heading,
  aggregate,
}: {
  scope: "floor" | "sketch";
  heading: string;
  aggregate: SketchAggregate;
}) {
  const { measurements, counts } = aggregate;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <dl className="grid grid-cols-2 gap-2">
        <Stat id={`${scope}-surface-area`} label="Surface area">
          {fmt(measurements.floorArea)} ft²
        </Stat>
        <Stat id={`${scope}-volume`} label="Volume">
          {fmt(measurements.volume)} ft³
        </Stat>
        <Stat id={`${scope}-rooms`} label="Rooms">
          {counts.rooms}
        </Stat>
        <Stat id={`${scope}-doors`} label="Doors">
          {counts.doors}
        </Stat>
        <Stat id={`${scope}-windows`} label="Windows">
          {counts.windows}
        </Stat>
      </dl>
    </section>
  );
}

function Stat({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd data-testid={id} className="text-sm font-semibold text-foreground">
        {children}
      </dd>
    </div>
  );
}

export function StatisticsPanel({ floor, sketch, floorName }: StatisticsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <StatBlock scope="floor" heading={floorName ?? "This floor"} aggregate={floor} />
      <StatBlock scope="sketch" heading="Whole sketch" aggregate={sketch} />
    </div>
  );
}
