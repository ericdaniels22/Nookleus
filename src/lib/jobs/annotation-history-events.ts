// Issue #854 — which Fabric canvas event owns the undo step for a text commit.
//
// Fabric v7's IText.exitEditing() fires, back to back on the canvas,
// `text:editing:exited` and then `object:modified` (the latter only when the
// text actually changed). The annotator records an undo step on both events —
// text:editing:exited is the commit point for a text edit, while object:modified
// is the commit point for every move/resize/endpoint-drag. With nothing to
// arbitrate, a single text edit lands as TWO identical pushes, so the user must
// Undo twice to revert one change (and the first Undo appears to do nothing).
//
// The rule: text:editing:exited OWNS a text commit, so the object:modified
// handler must defer to it for the text kind and not record a second step. Every
// other kind still records its move/resize from object:modified as before.

import { annotationKind } from "@/lib/jobs/annotation-toolbar";

/**
 * Whether the annotator's `object:modified` handler should record an undo step
 * for this target. False only for the text kind — a committed text edit is
 * already recorded by `text:editing:exited`, so recording again here would
 * double-push it (#854). True for every other Annotation kind (and for non-
 * Annotation targets), preserving the one-step-per-move/resize behaviour.
 */
export function shouldRecordModifiedStep(
  target: { type?: string } | undefined | null,
): boolean {
  return annotationKind(target?.type) !== "text";
}
