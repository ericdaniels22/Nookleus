// Issue #811 — the one pure place that decides which in-context toolbar a
// selected Annotation gets. The annotator's selection handler reads
// `annotationKind` to classify the Fabric object under selection.

export type AnnotationKind =
  | "arrow"
  | "ellipse"
  | "rectangle"
  | "polyline"
  | "polygon"
  | "text"
  | "freehand"
  | "marker";

export type ToolbarControl = "label" | "copy" | "delete";

/**
 * How far a duplicated Annotation is nudged down-and-right from its original, so
 * the copy is visibly offset rather than landing exactly on top. Pinned to the
 * Arrow duplicate's long-standing 30px so every kind copies consistently.
 */
export const DUPLICATE_OFFSET = 30;

/**
 * The Annotation kind each Fabric object `type` maps to. The casing here is the
 * subtle part: a *live* Fabric instance reports a lowercase `type`
 * (`"rect"`, `"fabricarrow"`, and notably `"i-text"` with a hyphen for IText),
 * while a *serialized* object and the static subclass `type` are PascalCase
 * (`"Rect"`, `"FabricArrow"`, `"IText"`). `annotationKind` lowercases its input
 * before the lookup, so the keys are lowercase — and IText carries both
 * spellings (`"i-text"` live, `"itext"` from a lowercased static) since
 * lowercasing alone cannot reconcile the hyphen. This is the single place that
 * knows which Fabric type is a toolbar-eligible Annotation.
 */
const KIND_BY_FABRIC_TYPE: Record<string, AnnotationKind> = {
  fabricarrow: "arrow",
  ellipse: "ellipse",
  rect: "rectangle",
  polyline: "polyline",
  polygon: "polygon",
  "i-text": "text",
  itext: "text",
  path: "freehand",
  fabricnumberedmarker: "marker",
};

/**
 * Map a Fabric object's `type` to the Annotation kind it represents. Case- and
 * form-insensitive: it accepts a live instance's lowercase `type` and a
 * serialized object's PascalCase `type` alike. Tolerates an absent type (the
 * caller passes `target?.type`) — the background image, groups, and anything
 * else not in the map are not Annotations, so they return null and get no
 * toolbar.
 */
export function annotationKind(
  fabricType: string | undefined | null
): AnnotationKind | null {
  if (!fabricType) return null;
  return KIND_BY_FABRIC_TYPE[fabricType.toLowerCase()] ?? null;
}

/** An object's top-edge box in canvas/scene coordinates. */
export interface AnchorBox {
  left: number;
  top: number;
  width: number;
}

/** The on-screen position of the canvas element (its `getBoundingClientRect`). */
export interface CanvasClientRect {
  left: number;
  top: number;
}

/**
 * The client-space point the floating toolbar anchors to: horizontally centred
 * on the object and level with its top edge. Callers translate the toolbar up
 * and by -50% in X from here so it sits centred just above the object. The same
 * math serves every kind — the caller supplies the arrow's endpoint box or any
 * other shape's bounding box.
 */
export function toolbarAnchorPoint(
  box: AnchorBox,
  canvasRect: CanvasClientRect
): { x: number; y: number } {
  return {
    x: canvasRect.left + box.left + box.width / 2,
    y: canvasRect.top + box.top,
  };
}

/**
 * The ordered set of controls a selected Annotation of this kind exposes. A
 * text box or a freehand drawing carries no Label or Copy — only Delete. A
 * Numbered marker carries Label and Delete but no Copy: duplicating it would
 * clone its number, which the auto-sequence (#816) owns, so the copy is
 * deliberately withheld. Every other kind gets the full Label, Copy, Delete row.
 */
export function toolbarControls(kind: AnnotationKind): ToolbarControl[] {
  if (kind === "text" || kind === "freehand") return ["delete"];
  if (kind === "marker") return ["label", "delete"];
  return ["label", "copy", "delete"];
}
