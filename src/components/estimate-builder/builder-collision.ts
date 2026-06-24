// Issue #680 — precise cross-section drop targeting in the line-item editor.
//
// The collision strategy for the shared builder DndContext (Estimate, Invoice,
// Estimate-template modes). The tree mixes droppables of very different sizes —
// a tall populated Section card next to a small or empty one — and closestCenter
// alone targets the nearest *center*, so a row dropped onto a small/empty
// container could resolve to a neighbour whose center is geometrically closer
// and spring back (#679/#680).
//
// This is the standard dnd-kit composite for mixed-size droppables, matching the
// Photo Report builder's photoReportCollisionDetection (#584): prefer what the
// pointer is actually over (pointerWithin) so the drop follows the pointer and
// any container the pointer is over — however small or empty — is reachable,
// then fall back to closestCenter for the keyboard-drag path, which carries no
// pointer. (rectIntersection is intentionally not interposed: a row dragged tall
// enough to sit its center over the wrong neighbour also overlaps that neighbour
// more, so rectIntersection would agree with closestCenter and not help here.)

import {
  closestCenter,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";

export const builderCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCenter(args);
};
