// Issue #584 — precise drop targeting on tall Section cards.
//
// The shared DndContext in the Photo Report builder used closestCenter, which
// targets the nearest droppable *center*. On a very tall Section card a photo
// dropped near the card's edge could resolve to a neighbouring Section whose
// center is geometrically closer (#467/#552 follow-up). photoReportCollisionDetection
// replaces it with the standard dnd-kit composite for mixed-size droppables:
// pointerWithin first (what the pointer is actually over), closestCenter as a
// fallback for the no-pointer keyboard-drag path. These tests drive that
// behaviour against the real dnd-kit algorithms, so they describe collision
// *outcomes*, not the wiring.

import { closestCenter, type Active, type CollisionDetection, type ClientRect } from "@dnd-kit/core";
import type { Coordinates } from "@dnd-kit/utilities";
import { describe, expect, it } from "vitest";

import { photoReportCollisionDetection } from "./photo-report-collision";

type CollisionArgs = Parameters<CollisionDetection>[0];

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// A minimal stand-in for dnd-kit's runtime collision args. Both algorithms read
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

describe("photoReportCollisionDetection", () => {
  it("targets the card the pointer is over, not the neighbour whose center is closer", () => {
    // A tall Section card with a short card stacked directly below it. The photo
    // is dropped near the tall card's bottom edge — inside the tall card, but
    // its rect's center is nearer the short card's center.
    const tall = rect(0, 0, 300, 400); // center (150, 200)
    const short = rect(0, 400, 300, 100); // center (150, 450)
    const collisionArgs = args({
      containers: [
        { id: "tall", rect: tall },
        { id: "short", rect: short },
      ],
      collisionRect: rect(110, 350, 80, 80), // dragged photo, center (150, 390)
      pointer: { x: 150, y: 390 }, // inside `tall`, above `short`
    });

    // Guard: the old strategy reproduces the bug here — closestCenter mis-picks
    // the neighbour because (150,390) is 60px from short's center but 190px from
    // tall's. The composite must not.
    expect(closestCenter(collisionArgs)[0]?.id).toBe("short");
    expect(photoReportCollisionDetection(collisionArgs)[0]?.id).toBe("tall");
  });

  it("falls back to closestCenter when there is no pointer (keyboard drag)", () => {
    // Keyboard drags (the rail's KeyboardSensor) carry no pointer, so
    // pointerWithin finds nothing. The drop must still resolve — to the
    // nearest droppable by center, exactly as before this change.
    const tall = rect(0, 0, 300, 400);
    const short = rect(0, 400, 300, 100);
    const collisionArgs = args({
      containers: [
        { id: "tall", rect: tall },
        { id: "short", rect: short },
      ],
      collisionRect: rect(110, 350, 80, 80), // center (150, 390), nearest short
      pointer: null,
    });

    expect(photoReportCollisionDetection(collisionArgs)).toEqual(
      closestCenter(collisionArgs),
    );
    expect(photoReportCollisionDetection(collisionArgs)[0]?.id).toBe("short");
  });
});
