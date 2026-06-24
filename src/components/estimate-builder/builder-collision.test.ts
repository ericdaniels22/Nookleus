// Issue #680 — cross-section line-item drag springs back.
//
// All three builder modes (Estimate, Invoice, Estimate-template) shared one
// DndContext wired with closestCenter, which targets the droppable whose
// *center* is nearest the dragged row's center. So the drop target followed the
// dragged row's midpoint, not the pointer: dropping a row onto another Section
// resolved to whichever container's center was geometrically closest, and small
// or empty containers — small rects, distant centers — were unreachable, so the
// row sprang back. builderCollisionDetection replaces it with the standard
// dnd-kit composite for mixed-size droppables (matching #584's
// photoReportCollisionDetection): pointerWithin first (what the pointer is
// actually over), then closestCenter as the no-pointer keyboard-drag fallback.
//
// These tests drive that behaviour against the real dnd-kit algorithms, so they
// describe collision *outcomes*, not the wiring.

import { closestCenter, type Active, type CollisionDetection, type ClientRect } from "@dnd-kit/core";
import type { Coordinates } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";

import { builderCollisionDetection } from "./builder-collision";

type CollisionArgs = Parameters<CollisionDetection>[0];

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// A minimal stand-in for dnd-kit's runtime collision args. The algorithms read
// only `id` off each droppable container (the rect comes from droppableRects)
// and ignore `active`, so those two fields are cast rather than fully built.
function args(opts: {
  containers: Array<{ id: string; rect: ClientRect }>;
  collisionRect: ClientRect;
  pointer: Coordinates | null;
}): CollisionArgs {
  return {
    active: { id: "dragged" } as unknown as Active,
    collisionRect: opts.collisionRect,
    droppableRects: new Map(opts.containers.map((c) => [c.id, c.rect])),
    droppableContainers: opts.containers.map((c) => ({
      id: c.id,
    })) as unknown as CollisionArgs["droppableContainers"],
    pointerCoordinates: opts.pointer,
  };
}

describe("builderCollisionDetection", () => {
  it("targets the Section the pointer is over, not the neighbour whose center is closer", () => {
    // A tall, populated Section card with a small/empty Section stacked directly
    // below it. A tall row is dragged down so the pointer is inside the small
    // Section — but the dragged row's rect is large, so its center still sits up
    // near the tall Section's center.
    const tall = rect(0, 0, 300, 400); // populated Section, center (150, 200)
    const small = rect(0, 400, 300, 60); // small/empty Section, center (150, 430)
    const collisionArgs = args({
      containers: [
        { id: "tall", rect: tall },
        { id: "small", rect: small },
      ],
      collisionRect: rect(110, 120, 80, 290), // dragged row, center (150, 265)
      pointer: { x: 150, y: 405 }, // inside `small`, below `tall`
    });

    // Guard: the old strategy reproduces the spring-back here — the dragged
    // row's center (150,265) is 65px from tall's center but 165px from small's,
    // so closestCenter mis-targets the tall neighbour the pointer left behind.
    expect(closestCenter(collisionArgs)[0]?.id).toBe("tall");
    expect(builderCollisionDetection(collisionArgs)[0]?.id).toBe("small");
  });

  it("falls back to closestCenter when there is no pointer (keyboard drag)", () => {
    // Keyboard drags (the KeyboardSensor) carry no pointer, so pointerWithin
    // finds nothing. The drop must still resolve — to the nearest droppable by
    // center, exactly as before this change — so a keyboard reorder never dead-ends.
    const tall = rect(0, 0, 300, 400);
    const small = rect(0, 400, 300, 60);
    const collisionArgs = args({
      containers: [
        { id: "tall", rect: tall },
        { id: "small", rect: small },
      ],
      collisionRect: rect(110, 360, 80, 80), // center (150, 400), nearest small
      pointer: null,
    });

    expect(builderCollisionDetection(collisionArgs)).toEqual(
      closestCenter(collisionArgs),
    );
    expect(builderCollisionDetection(collisionArgs)[0]?.id).toBe("small");
  });
});
