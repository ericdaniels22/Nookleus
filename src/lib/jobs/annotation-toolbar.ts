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
  | "freehand";

export type ToolbarControl = "label" | "copy" | "delete";

/**
 * How far a duplicated Annotation is nudged down-and-right from its original, so
 * the copy is visibly offset rather than landing exactly on top. Pinned to the
 * Arrow duplicate's long-standing 30px so every kind copies consistently.
 */
export const DUPLICATE_OFFSET = 30;

/**
 * The Annotation kind each Fabric object `type` maps to. Fabric stamps the
 * subclass name (PascalCase) on `type`; this is the single place that knows
 * which of those is a toolbar-eligible Annotation.
 */
const KIND_BY_FABRIC_TYPE: Record<string, AnnotationKind> = {
  FabricArrow: "arrow",
  Ellipse: "ellipse",
  Rect: "rectangle",
  Polyline: "polyline",
  Polygon: "polygon",
  IText: "text",
  Path: "freehand",
};

/**
 * Map a Fabric object's `type` to the Annotation kind it represents. Tolerates
 * an absent type (the caller passes `target?.type`) — the background image,
 * groups, and anything else not in the map are not Annotations, so they return
 * null and get no toolbar.
 */
export function annotationKind(
  fabricType: string | undefined | null
): AnnotationKind | null {
  if (!fabricType) return null;
  return KIND_BY_FABRIC_TYPE[fabricType] ?? null;
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
 * text box or a freehand drawing carries no Label or Copy — only Delete — while
 * every other kind gets the full Label, Copy, Delete row.
 */
export function toolbarControls(kind: AnnotationKind): ToolbarControl[] {
  if (kind === "text" || kind === "freehand") return ["delete"];
  return ["label", "copy", "delete"];
}
