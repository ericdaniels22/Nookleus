import { describe, expect, it } from "vitest";

import { snapAnnotation } from "./annotation-snapping";

describe("snapAnnotation", () => {
  it("snaps a left edge within threshold and draws the matching vertical guide", () => {
    const moving = { left: 104, top: 200, width: 50, height: 30 };
    const others = [{ left: 100, top: 0, width: 40, height: 20 }];

    const result = snapAnnotation(moving, others, { x: 8, y: 8 });

    expect(result.snappedPosition).toEqual({ left: 100, top: 200 });
    expect(result.guideLines).toEqual([{ orientation: "vertical", position: 100 }]);
  });

  it("snaps center-to-center and draws the guide through the shared center", () => {
    // moving centerX = 234, other centerX = 230 (delta -4, within threshold);
    // every edge pair is farther apart, so the center match wins.
    const moving = { left: 204, top: 0, width: 60, height: 20 };
    const others = [{ left: 100, top: 500, width: 260, height: 30 }];

    const result = snapAnnotation(moving, others, { x: 8, y: 8 });

    expect(result.snappedPosition).toEqual({ left: 200, top: 0 });
    expect(result.guideLines).toEqual([{ orientation: "vertical", position: 230 }]);
  });

  it("leaves position unchanged with no guides when nothing is within threshold", () => {
    const moving = { left: 100, top: 100, width: 40, height: 20 };
    const others = [{ left: 300, top: 300, width: 40, height: 20 }];

    const result = snapAnnotation(moving, others, { x: 8, y: 8 });

    expect(result.snappedPosition).toEqual({ left: 100, top: 100 });
    expect(result.guideLines).toEqual([]);
  });

  it("snaps both axes at once and returns a vertical and a horizontal guide", () => {
    // Left edges 4px apart and top edges 4px apart; both within threshold and
    // independently the closest match on their axis.
    const moving = { left: 104, top: 204, width: 50, height: 50 };
    const others = [{ left: 100, top: 200, width: 40, height: 40 }];

    const result = snapAnnotation(moving, others, { x: 8, y: 8 });

    expect(result.snappedPosition).toEqual({ left: 100, top: 200 });
    expect(result.guideLines).toEqual([
      { orientation: "vertical", position: 100 },
      { orientation: "horizontal", position: 200 },
    ]);
  });

  it("produces no snap and no guides when there are no other Annotations", () => {
    // The dragged object is never measured against itself — only `others` are
    // candidates — so an empty `others` leaves it free with nothing to align to.
    const moving = { left: 100, top: 100, width: 40, height: 20 };

    const result = snapAnnotation(moving, [], { x: 8, y: 8 });

    expect(result.snappedPosition).toEqual({ left: 100, top: 100 });
    expect(result.guideLines).toEqual([]);
  });
});
