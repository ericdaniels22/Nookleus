"use client";

// Issue #870 — Sketch S10, the read-only 3D "dollhouse" viewer (M10, ADR 0025).
// Extrudes every Room on the active Floor (M9 → three via room-geometry) and
// stands them in an orbitable scene: walls to their ceiling height, a floor slab,
// open top so the camera looks down into the rooms. READ-ONLY — OrbitControls
// pan/rotate/zoom the *camera*, but nothing here selects, drags or reshapes a
// Room; all authoring stays on the 2D canvas. The editor shell loads this
// client-only (dynamic ssr:false) because three needs a WebGL context, mirroring
// the Jarvis NeuralNetworkScene idiom.

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Center, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

import type { Floor, Room } from "@/lib/types";
import { extrudeRoomFromModel } from "@/lib/sketch/extrude-geometry";
import { buildRoomGeometry } from "@/lib/sketch/room-geometry";

interface Sketch3DViewerProps {
  /** The Rooms placed on the active Floor — the same set the 2D canvas draws. */
  rooms: Room[];
  /** The active Floor, for the ceiling-height and thickness defaults (M9). */
  floor: Floor;
}

export default function Sketch3DViewer({ rooms, floor }: Sketch3DViewerProps) {
  // Build one three geometry per Room from the pure extrusion. Memoized on the
  // inputs so an orbit (which re-renders nothing here) doesn't rebuild the plan.
  const meshes = useMemo(
    () =>
      rooms.map((room) => ({
        id: room.id,
        geometry: buildRoomGeometry(extrudeRoomFromModel(room, floor)),
      })),
    [rooms, floor],
  );

  return (
    <Canvas camera={{ position: [30, 30, 30], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b0f14"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[15, 30, 20]} intensity={0.9} />
      {/* Center the whole plan on the origin so the orbit camera frames it. */}
      <Center>
        {meshes.map(({ id, geometry }) => (
          <mesh key={id} geometry={geometry}>
            <meshStandardMaterial
              color="#cbd5e1"
              roughness={0.9}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </Center>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
