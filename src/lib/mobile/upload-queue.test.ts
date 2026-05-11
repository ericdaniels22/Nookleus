import { describe, it, expect } from "vitest";
import {
  computeBackoffMs,
  isStaleUploadingClaim,
  needsUploadStateBackfill,
} from "./upload-queue";

describe("upload-queue pure logic", () => {
  describe("computeBackoffMs", () => {
    it("returns 1000 for retry_count 0", () => {
      expect(computeBackoffMs(0)).toBe(1000);
    });
    it("returns 5000 for retry_count 1", () => {
      expect(computeBackoffMs(1)).toBe(5000);
    });
    it("returns 30000 for retry_count 2", () => {
      expect(computeBackoffMs(2)).toBe(30000);
    });
    it("returns null for retry_count >= 3 (no further retries)", () => {
      expect(computeBackoffMs(3)).toBeNull();
      expect(computeBackoffMs(99)).toBeNull();
    });
  });

  describe("isStaleUploadingClaim", () => {
    it("true when state=uploading + owner != current pid", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "uploading", worker_owner_pid: "old-pid" } as any,
          "current-pid",
        ),
      ).toBe(true);
    });
    it("false when state=uploading + owner == current pid", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "uploading", worker_owner_pid: "current-pid" } as any,
          "current-pid",
        ),
      ).toBe(false);
    });
    it("false when state != uploading (regardless of owner)", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "pending", worker_owner_pid: "old-pid" } as any,
          "current-pid",
        ),
      ).toBe(false);
    });
  });

  describe("needsUploadStateBackfill", () => {
    it.each(["pending", "uploading", "failed", "synced"] as const)(
      "false for valid state %s",
      (state) => {
        expect(needsUploadStateBackfill({ upload_state: state } as any)).toBe(
          false,
        );
      },
    );
    it("true for 'unknown' (legacy pre-65c sidecars)", () => {
      expect(needsUploadStateBackfill({ upload_state: "unknown" } as any)).toBe(
        true,
      );
    });
    it("true when upload_state is undefined", () => {
      expect(needsUploadStateBackfill({} as any)).toBe(true);
    });
    it("true when upload_state is null", () => {
      expect(needsUploadStateBackfill({ upload_state: null } as any)).toBe(
        true,
      );
    });
    it("true when upload_state is empty string", () => {
      expect(needsUploadStateBackfill({ upload_state: "" } as any)).toBe(true);
    });
  });
});
