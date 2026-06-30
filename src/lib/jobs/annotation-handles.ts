// Issue #810 — the one place editor-only handle sizing lives.
//
// Selection/resize handles are Fabric "controls": chrome drawn on top of the
// canvas only while an Annotation is selected for editing. They are never
// serialized into the saved annotation markup and never burned into the
// flattened Annotated Photo PNG, so their size is purely an editor-interaction
// concern. Centralizing it here means every Annotation object type — Arrow
// endpoints, circle/rectangle/text corners, polyline/polygon vertices — gets
// the same finger-friendly touch target, whether freshly drawn or reloaded
// from saved markup. Kept free of Fabric/React/DOM so it lives in exactly one
// tested place.

/**
 * Comfortable fingertip touch target, in canvas pixels (Apple HIG minimum
 * ≈ 44px). Every handle's touch hit area is at least this big.
 */
export const HANDLE_TOUCH_TARGET = 44;

/**
 * Rendered size of a handle, in canvas pixels. Larger than the 13–14px shipped
 * before #810, but kept modest so a handle stays proportionate and does not
 * obscure a small Annotation. The touch hit area (HANDLE_TOUCH_TARGET) is
 * decoupled from this, so handles are easy to grab without ballooning visually.
 */
export const HANDLE_VISUAL_SIZE = 20;

/**
 * Visual radius of the round endpoint handles the Arrow draws itself (it renders
 * its own circle in a custom control rather than using a Fabric corner). Half of
 * HANDLE_VISUAL_SIZE so an Arrow endpoint and a corner/vertex handle read as the
 * same size on screen.
 */
export const ARROW_HANDLE_RADIUS = HANDLE_VISUAL_SIZE / 2;

/**
 * The size-only handle props for a Fabric corner-based Annotation (circle,
 * rectangle, text, polyline, polygon). Spread onto the object's options or
 * `.set()`. `cornerSize` is the rendered + mouse-hit size; `touchCornerSize`
 * is the finger hit area. Colour, shape and style are deliberately left to the
 * caller / Fabric defaults so this slice changes size and nothing else.
 */
export function handleSizeProps(): {
  cornerSize: number;
  touchCornerSize: number;
} {
  return { cornerSize: HANDLE_VISUAL_SIZE, touchCornerSize: HANDLE_TOUCH_TARGET };
}

/**
 * Hit-box dimensions for an Arrow tip/tail endpoint Control. The Arrow uses a
 * custom Fabric Control (not a corner), so its hit area is expressed as explicit
 * box sizes: `size*` is the mouse/desktop hit box, `touchSize*` the finger hit
 * area. Both axes get the full HANDLE_TOUCH_TARGET on touch; the mouse box keeps
 * at least its pre-#810 width so pointer use is unaffected.
 */
export function arrowHandleHitArea(): {
  sizeX: number;
  sizeY: number;
  touchSizeX: number;
  touchSizeY: number;
} {
  return {
    sizeX: HANDLE_VISUAL_SIZE,
    sizeY: HANDLE_VISUAL_SIZE,
    touchSizeX: HANDLE_TOUCH_TARGET,
    touchSizeY: HANDLE_TOUCH_TARGET,
  };
}
