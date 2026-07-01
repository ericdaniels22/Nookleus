import { describe, expect, it } from "vitest";
import { extrudeRoom } from "./extrude-geometry";
import { rectangleFootprint } from "./footprint";
import { buildRoomGeometry } from "./room-geometry";

describe("buildRoomGeometry", () => {
  it("wires an extruded mesh's vertices and faces into a three BufferGeometry", () => {
    // The bridge from M9's pure data to the viewer's renderer (M10): whatever
    // extrudeRoom produced must survive intact into three, so the dollhouse the
    // camera orbits is exactly the mesh the unit tests pinned — walls on their
    // edges, at their heights.
    const mesh = extrudeRoom({ footprint: rectangleFootprint(3, 4), height: 8 });
    const geometry = buildRoomGeometry(mesh);

    const position = geometry.getAttribute("position");
    expect(position.count).toBe(mesh.positions.length / 3); // 20 vertices
    expect(Array.from(position.array)).toEqual(mesh.positions);

    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    expect(Array.from(index!.array)).toEqual(mesh.indices);
  });

  it("computes vertex normals so the dollhouse lights as a solid, not a black shell", () => {
    // Without normals a MeshStandardMaterial renders unlit (black), so the
    // extruded shell would orbit as a silhouette. The bridge derives them from
    // the faces, one unit normal per vertex.
    const mesh = extrudeRoom({ footprint: rectangleFootprint(3, 4), height: 8 });
    const geometry = buildRoomGeometry(mesh);

    const normal = geometry.getAttribute("normal");
    expect(normal).toBeDefined();
    expect(normal.count).toBe(geometry.getAttribute("position").count);
    for (let i = 0; i < normal.count; i++) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(length).toBeCloseTo(1);
    }
  });

  it("builds an empty geometry from a degenerate mesh without throwing", () => {
    // A half-drawn Room extrudes to nothing (extrude-geometry.ts); the viewer
    // still maps it, so the bridge must yield an empty geometry rather than crash
    // the whole scene.
    const geometry = buildRoomGeometry({ positions: [], indices: [] });
    expect(geometry.getAttribute("position").count).toBe(0);
  });
});
