// The annotator's editor overlays (snapping guides, in-progress Polyline preview,
// Label pills) draw on the raw canvas context inside `after:render`, which fires
// with the live viewport transform already restored off the context. To paint in
// scene coordinates each overlay re-applies that transform — but doing so also
// magnifies any fixed-size chrome (vertex dots, dashed guide lines) along with the
// content. This is the one tested place that reads the uniform zoom factor back
// out of the matrix so that chrome can be divided by it and kept a constant
// on-screen size. Kept free of Fabric/React/DOM so the math lives in one place.

/**
 * A Fabric viewport transform: the six numbers of a 2-D affine matrix
 * `[a, b, c, d, e, f]`. For the annotator's pan/zoom (uniform scale + translate,
 * no rotation or skew) this is `[zoom, 0, 0, zoom, panX, panY]`.
 */
export type ViewportTransform = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * The uniform on-screen zoom factor of a viewport transform — the number a scene
 * length is multiplied by when drawn through the transform. Read off the `a`
 * entry, which Fabric's pan/zoom keeps equal to `d`. A missing transform (Fabric
 * has not initialised one yet) or a non-positive/non-finite scale falls back to
 * `1`, so callers can safely divide chrome sizes by the result.
 */
export function viewportScale(
  vpt: ViewportTransform | null | undefined
): number {
  const scale = vpt?.[0];
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0
    ? scale
    : 1;
}

/** The identity transform — used when Fabric has not initialised one yet. */
const IDENTITY: ViewportTransform = [1, 0, 0, 1, 0, 0];

/**
 * Map a point from scene coordinates to its on-screen (canvas-surface) position
 * by applying the affine viewport transform: for `[a, b, c, d, e, f]`,
 * `screen = (a·x + c·y + e, b·x + d·y + f)`. This is how the floating chrome
 * (in-context toolbar, Label editor) finds where a selected Annotation actually
 * sits on screen once the view is zoomed/panned — Fabric reports an object's
 * bounding box in the scene plane, not where the pixels land. A missing
 * transform is treated as the identity, so at fit-zoom the point is unchanged.
 */
export function viewportPoint(
  vpt: ViewportTransform | null | undefined,
  x: number,
  y: number
): { x: number; y: number } {
  const m = vpt ?? IDENTITY;
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Convert an on-screen distance to the scene-space length that renders to it at
 * the current zoom — `screenPx / zoom`. The snap engine measures in scene
 * pixels, so feeding it a fixed scene threshold makes snapping over-eager when
 * zoomed in and unreachable when zoomed out; converting the threshold through
 * this keeps the snap "feel" a constant on-screen distance at any zoom. A
 * missing transform falls back to unit zoom, leaving the length unchanged.
 */
export function screenToSceneLength(
  screenPx: number,
  vpt: ViewportTransform | null | undefined
): number {
  return screenPx / viewportScale(vpt);
}
