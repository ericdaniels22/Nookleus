import { describe, it, expect } from "vitest";

import { ANNOTATION_CUSTOM_PROPS } from "./photo-annotation-format";
import {
  ARROW_HANDLE_RADIUS,
  arrowHandleHitArea,
  handleSizeProps,
} from "./annotation-handles";

// The handle sizes that shipped before #810: polyline/polygon vertices used
// cornerSize 14, and every Fabric corner (circle/rect/text + un-set poly touch)
// fell back to Fabric's defaults of cornerSize 13 / touchCornerSize 24.
const LEGACY_MAX_CORNER_SIZE = 14;
const LEGACY_TOUCH_CORNER_SIZE = 24;
// The Arrow drew its own endpoint handles: a radius-8 circle inside a 20px
// mouse hit box / 30px touch hit box.
const LEGACY_ARROW_VISUAL_RADIUS = 8;
const LEGACY_ARROW_MOUSE_HIT = 20;

describe("handleSizeProps — finger-sized touch target", () => {
  it("gives every Annotation handle a touch hit area of at least ~44px (Apple HIG minimum)", () => {
    expect(handleSizeProps().touchCornerSize).toBeGreaterThanOrEqual(44);
  });

  it("is measurably larger than the handles shipped before #810", () => {
    const { cornerSize, touchCornerSize } = handleSizeProps();
    expect(cornerSize).toBeGreaterThan(LEGACY_MAX_CORNER_SIZE);
    expect(touchCornerSize).toBeGreaterThan(LEGACY_TOUCH_CORNER_SIZE);
  });

  it("changes size only — it never carries a colour, shape or style prop", () => {
    // AC4: each handle keeps the shape, colour and style it has today; this
    // slice changes size and nothing else. The helper must therefore emit only
    // size keys, leaving cornerColor / cornerStyle / transparentCorners to the
    // caller and Fabric defaults.
    expect(Object.keys(handleSizeProps()).sort()).toEqual([
      "cornerSize",
      "touchCornerSize",
    ]);
  });
});

describe("arrowHandleHitArea — Arrow tip/tail endpoints", () => {
  it("gives each endpoint a ~44px finger touch target on both axes", () => {
    const { touchSizeX, touchSizeY } = arrowHandleHitArea();
    expect(touchSizeX).toBeGreaterThanOrEqual(44);
    expect(touchSizeY).toBeGreaterThanOrEqual(44);
  });

  it("does not shrink the mouse/desktop hit box below what shipped before #810", () => {
    // AC7: handles remain usable with a pointer.
    const { sizeX, sizeY } = arrowHandleHitArea();
    expect(sizeX).toBeGreaterThanOrEqual(LEGACY_ARROW_MOUSE_HIT);
    expect(sizeY).toBeGreaterThanOrEqual(LEGACY_ARROW_MOUSE_HIT);
  });

  it("enlarges the rendered endpoint circle proportionately (bigger than the old radius-8 dot)", () => {
    expect(ARROW_HANDLE_RADIUS).toBeGreaterThan(LEGACY_ARROW_VISUAL_RADIUS);
  });
});

describe("every Annotation type shares one handle size", () => {
  it("uses an identical touch target for Arrow endpoints and corner/vertex handles", () => {
    // AC2: no object type is left on the old smaller handle size.
    expect(arrowHandleHitArea().touchSizeX).toBe(handleSizeProps().touchCornerSize);
    expect(arrowHandleHitArea().touchSizeY).toBe(handleSizeProps().touchCornerSize);
  });

  it("renders Arrow endpoints and corner/vertex handles at the same visual size", () => {
    // AC4: the Arrow's circle (radius) and a Fabric corner (full size) read as
    // the same on-screen size, so no handle balloons out of proportion.
    expect(ARROW_HANDLE_RADIUS * 2).toBe(handleSizeProps().cornerSize);
  });
});

describe("handles are editor-only chrome", () => {
  it("writes no handle-size value into saved Annotation markup", () => {
    // AC5: the saved markup carries only the FabricArrow custom props. Fabric's
    // toJSON projection (canvas.toJSON([...ANNOTATION_CUSTOM_PROPS])) never asks
    // for these handle props, and they are not in Fabric's default serialized
    // set either, so no handle-size value is ever persisted.
    const handleProps = [
      ...Object.keys(handleSizeProps()),
      ...Object.keys(arrowHandleHitArea()),
    ];
    for (const prop of handleProps) {
      expect(ANNOTATION_CUSTOM_PROPS as readonly string[]).not.toContain(prop);
    }
  });
});
