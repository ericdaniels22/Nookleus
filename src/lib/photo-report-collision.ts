// Issue #584 — precise drop targeting on tall Section cards.
//
// The collision strategy for the Photo Report builder's shared DndContext. The
// builder mixes droppables of very different sizes (a tall Section card next to
// a short one), and closestCenter alone targets the nearest *center*, so a photo
// dropped near a tall card's edge could land in a neighbour whose center is
// geometrically closer (#467/#552 follow-up).
//
// This is the standard dnd-kit composite for mixed-size droppables: prefer what
// the pointer is actually over (pointerWithin), and fall back to closestCenter
// for the keyboard-drag path, which carries no pointer.

import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

export const photoReportCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCenter(args);
};
