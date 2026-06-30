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
