import { Capacitor, registerPlugin } from "@capacitor/core";

/** RoomPlan's per-surface/object confidence in a detection. */
export type CaptureConfidence = "low" | "medium" | "high";

/**
 * A wall, door, window, or opening RoomPlan detected. Mirrors the fields
 * RoomPlan's `CapturedRoom.Surface` serializes; the mapping slice (separate)
 * turns these into the parametric Room's footprint + openings.
 */
export interface CapturedSurface {
  /** RoomPlan surface UUID. */
  identifier: string;
  /** Width, height, length in metres (RoomPlan's `dimensions` simd_float3). */
  dimensions: [number, number, number];
  /** Column-major 4×4 model transform, 16 floats. */
  transform: number[];
  confidence: CaptureConfidence;
}

/** A detected object (cabinet, appliance, fixture) — inventory, not measured. */
export interface CapturedObject extends CapturedSurface {
  /** RoomPlan object category, e.g. "storage", "refrigerator", "sink". */
  category: string;
}

/**
 * The RoomPlan capture payload: the room geometry as RoomPlan reports it,
 * before it is mapped onto the Sketch's parametric Room model.
 */
export interface CapturedRoom {
  walls: CapturedSurface[];
  doors: CapturedSurface[];
  windows: CapturedSurface[];
  openings: CapturedSurface[];
  objects: CapturedObject[];
}

/** The result of one scan: the captured room plus a reference to its mesh. */
export interface RoomScan {
  room: CapturedRoom;
  /**
   * Local file URI of the USDZ mesh the plugin wrote to device storage. The
   * mesh is uploaded to Supabase and attached to the Sketch in a later slice
   * (parallel to how Photos capture locally, then sync).
   */
  meshUri: string;
}

/**
 * The native `RoomPlanCapture` Capacitor plugin (issue #863, PRD #859 slice
 * S11). Implemented in Swift in the iOS App target wrapping Apple RoomPlan —
 * see `ios/App/App/RoomPlanCapturePlugin.swift`. There is no web
 * implementation; capture only exists on LiDAR iOS devices.
 */
interface RoomPlanCapturePlugin {
  /** Reports whether RoomPlan can run on this device (iOS 16+ with LiDAR). */
  isSupported(): Promise<{ supported: boolean }>;
  /**
   * Launches RoomPlan, returning the CapturedRoom as a JSON string (RoomPlan's
   * `CapturedRoom` is `Codable`, so the plugin serializes it directly) plus a
   * `meshUri` pointing at the USDZ the plugin wrote to local device storage.
   */
  scanRoom(): Promise<{ capturedRoomJson: string; meshUri: string }>;
}

const RoomPlanCapture = registerPlugin<RoomPlanCapturePlugin>("RoomPlanCapture");

/**
 * Whether the assisted RoomPlan scan should be offered on this device.
 *
 * Always false off the native iOS shell — the web app, desktop, and non-LiDAR
 * devices author the Sketch by hand (ADR 0025), so callers hide the scan
 * affordance when this resolves false.
 */
export async function isRoomPlanScanAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const { supported } = await RoomPlanCapture.isSupported();
  return supported;
}

/**
 * Runs a RoomPlan scan and returns the captured room plus a reference to the
 * mesh the plugin wrote to local device storage. Callers gate this behind
 * {@link isRoomPlanScanAvailable}; invoking it off the native shell throws
 * rather than silently resolving through the no-op web proxy.
 */
export async function scanRoom(): Promise<RoomScan> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("RoomPlan scanning is not supported on this device");
  }
  const { capturedRoomJson, meshUri } = await RoomPlanCapture.scanRoom();
  return { room: JSON.parse(capturedRoomJson) as CapturedRoom, meshUri };
}
