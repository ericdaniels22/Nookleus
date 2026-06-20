/**
 * Rubber-band resistance for a pull-to-refresh drag (#677). Framework-free so
 * it can be unit-tested without React or Capacitor.
 *
 * Maps raw finger travel (`pull`, px) to how far the spinner row actually
 * reveals, with iOS-style resistance: the row tracks the finger ~1:1 at first,
 * then stiffens — each additional px of pull reveals progressively less — and
 * asymptotically approaches `max` without ever exceeding it. So the drag always
 * responds to the finger, but you can never yank the row open arbitrarily far.
 *
 * The curve is the saturating `(max * pull) / (max + pull)`: slope 1 at the
 * origin (attached to the finger), tending to `max` as `pull → ∞`.
 */
export function resistedReveal(pull: number, max: number): number {
  if (pull <= 0) return 0;
  return (max * pull) / (max + pull);
}
