// The collection ring is a hand-rolled SVG arc (no charting dependency). This
// pure helper turns a collection rate into the stroke-dash values that reveal
// that fraction of a circle, clamped so an over-collected Job can never paint
// more than a full ring.
export type RingGeometry = {
  radius: number;
  circumference: number;
  /** the rate clamped into [0, 1] */
  fraction: number;
  /** the fraction as a rounded whole percent, for display/aria */
  percent: number;
  /** the full circumference — the progress stroke's dash length */
  dashArray: number;
  /** the offset that hides the unfilled remainder (0 = a full ring) */
  dashOffset: number;
};

const DEFAULT_RADIUS = 36;

export function ringGeometry(rate: number, radius: number = DEFAULT_RADIUS): RingGeometry {
  const fraction = Math.max(0, Math.min(1, rate));
  const circumference = 2 * Math.PI * radius;
  return {
    radius,
    circumference,
    fraction,
    percent: Math.round(fraction * 100),
    dashArray: circumference,
    dashOffset: circumference * (1 - fraction),
  };
}
