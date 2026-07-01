import { describe, it, expect, beforeEach, vi } from "vitest";

// The native platform flag and plugin methods are togglable per test. The
// mock factory reads these lazily (at call time), so a test can flip
// `nativePlatform` before exercising the wrapper.
let nativePlatform = false;
const isSupportedMock = vi.fn();
const scanRoomMock = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform },
  registerPlugin: () => ({
    isSupported: (...args: unknown[]) => isSupportedMock(...args),
    scanRoom: (...args: unknown[]) => scanRoomMock(...args),
  }),
}));

// Import after the mock so the wrapper binds to the mocked plugin.
import { isRoomPlanScanAvailable, scanRoom } from "./roomplan-capture";

describe("isRoomPlanScanAvailable", () => {
  beforeEach(() => {
    nativePlatform = false;
    isSupportedMock.mockReset();
    scanRoomMock.mockReset();
  });

  it("reports unavailable off the native platform (web/desktop degrade to hand-draw)", async () => {
    nativePlatform = false;

    await expect(isRoomPlanScanAvailable()).resolves.toBe(false);
    // The native plugin is never consulted off-native.
    expect(isSupportedMock).not.toHaveBeenCalled();
  });

  it("reports available on a native LiDAR device the plugin says supports RoomPlan", async () => {
    nativePlatform = true;
    isSupportedMock.mockResolvedValue({ supported: true });

    await expect(isRoomPlanScanAvailable()).resolves.toBe(true);
    expect(isSupportedMock).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable on a native device without LiDAR the plugin says is unsupported", async () => {
    nativePlatform = true;
    isSupportedMock.mockResolvedValue({ supported: false });

    await expect(isRoomPlanScanAvailable()).resolves.toBe(false);
  });
});

describe("scanRoom", () => {
  beforeEach(() => {
    nativePlatform = false;
    isSupportedMock.mockReset();
    scanRoomMock.mockReset();
  });

  it("rejects off the native platform instead of invoking the missing native path", async () => {
    nativePlatform = false;

    await expect(scanRoom()).rejects.toThrow(/not supported/i);
    expect(scanRoomMock).not.toHaveBeenCalled();
  });

  it("returns the parsed captured room and mesh reference from a native scan", async () => {
    nativePlatform = true;
    const capturedRoom = {
      walls: [
        {
          identifier: "wall-1",
          dimensions: [3.2, 2.4, 0.1],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          confidence: "high",
        },
      ],
      doors: [],
      windows: [
        {
          identifier: "win-1",
          dimensions: [1.1, 1.3, 0.05],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1.5, 0, 0, 1],
          confidence: "medium",
        },
      ],
      openings: [],
      objects: [
        {
          identifier: "obj-1",
          category: "refrigerator",
          dimensions: [0.9, 1.8, 0.7],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 1, 1],
          confidence: "high",
        },
      ],
    };
    scanRoomMock.mockResolvedValue({
      capturedRoomJson: JSON.stringify(capturedRoom),
      meshUri: "file:///var/mobile/.../pending-uploads/scan-1.usdz",
    });

    const scan = await scanRoom();

    expect(scanRoomMock).toHaveBeenCalledTimes(1);
    expect(scan.meshUri).toBe("file:///var/mobile/.../pending-uploads/scan-1.usdz");
    expect(scan.room.walls).toHaveLength(1);
    expect(scan.room.windows[0].identifier).toBe("win-1");
    expect(scan.room.objects[0].category).toBe("refrigerator");
  });
});
