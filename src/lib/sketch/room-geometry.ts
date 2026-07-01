// Issue #870 — Sketch S10, the bridge from the pure extrusion (M9) to three.js
// (M10). extrude-geometry.ts stays framework-free so its rule is unit-tested in
// isolation; this thin adapter lifts its flat [x,y,z] / index buffers into a
// three BufferGeometry the read-only dollhouse viewer draws. Kept out of the
// viewer component (and free of @react-three/*) so it runs — and is tested —
// without a WebGL context.

import * as THREE from "three";
import type { ExtrudedMesh } from "./extrude-geometry";

/** Build the three geometry for one extruded Room from its {@link ExtrudedMesh}. */
export function buildRoomGeometry({
  positions,
  indices,
}: ExtrudedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  // Derive per-vertex normals from the faces so a lit material shades the shell
  // (the extrusion carries only positions). Each wall quad and the floor slab own
  // their vertices, so no crease is averaged across non-coplanar faces.
  geometry.computeVertexNormals();
  return geometry;
}
