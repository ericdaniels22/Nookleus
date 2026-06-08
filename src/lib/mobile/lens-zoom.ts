/**
 * Pure decision logic for the camera lens toggle (0.5× / 1× / 2×).
 *
 * Framework-free so it can be unit-tested without React or Capacitor. The
 * component (`camera-view.tsx`) and the lifecycle hook own the side effects;
 * this module owns the rules. See
 * docs/superpowers/specs/2026-06-08-camera-lens-zoom-design.md §7.
 */

export type LensFactor = 0.5 | 1 | 2;

/**
 * The stops the pill should display. Returns [] (hide the pill entirely) on
 * the front camera or when one or fewer factors are available. Otherwise the
 * available factors are returned as-is (the native layer owns availability).
 */
export function visibleZoomFactors(
  available: number[],
  position: "rear" | "front",
): number[] {
  if (position === "front") return [];
  if (available.length <= 1) return [];
  return available;
}

/**
 * Next UI state after the user taps `factor`. Optimistic: selectedFactor moves
 * immediately; confirmedFactor only changes once a setZoom actually resolves.
 */
export function selectFactor(
  state: { selectedFactor: number; confirmedFactor: number },
  factor: number,
): { selectedFactor: number; confirmedFactor: number } {
  return { selectedFactor: factor, confirmedFactor: state.confirmedFactor };
}

/** Revert helper for a rejected setZoom: snap selectedFactor back to confirmed. */
export function revertFactor(state: {
  selectedFactor: number;
  confirmedFactor: number;
}): { selectedFactor: number; confirmedFactor: number } {
  return {
    selectedFactor: state.confirmedFactor,
    confirmedFactor: state.confirmedFactor,
  };
}

/** "0.5×", "1×", "2×" — the label shown on each pill segment. */
export function formatFactorLabel(factor: number): string {
  return `${factor}×`;
}
