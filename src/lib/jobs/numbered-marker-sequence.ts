// Issue #816 — the one pure place that decides the number a freshly-dropped
// Numbered marker gets. Each drop is auto-assigned the next number in the
// Photo's sequence so placement order is deterministic and unit-testable. Kept
// free of Fabric/DOM/React so the rule lives in exactly one tested place — the
// annotator's tap-to-drop handler reads `existing marker numbers` off the
// canvas and asks this for the next one.

/**
 * The number to assign the next Numbered marker dropped on a Photo, given the
 * numbers of the markers already on it. An empty Photo starts the sequence at
 * 1; otherwise the next number continues from the highest already present (so
 * markers 1, 2, 3 yield 4). It is the highest-plus-one, not the count-plus-one,
 * so a deleted marker is never resequenced and never re-used (#816 scope
 * boundary — auto-renumber-on-delete is a separate slice).
 */
export function nextMarkerNumber(existingNumbers: number[]): number {
  if (existingNumbers.length === 0) return 1;
  return Math.max(...existingNumbers) + 1;
}
