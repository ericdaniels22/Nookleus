import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  validateAttachment,
  resizeImage,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_EDGE_PX,
} from "./normalize";

// Issue #198 — a user attaches one image to a Jarvis Core message. The
// normalization module is the gate: it decides what counts as an
// attachable image before anything reaches storage or Claude.

describe("validateAttachment", () => {
  it("accepts a supported image type", () => {
    const result = validateAttachment({ type: "image/jpeg", size: 1024 });
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported type with a clear error", () => {
    const result = validateAttachment({
      type: "application/pdf",
      size: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/pdf/i);
      expect(result.error).toMatch(/image/i);
    }
  });

  it("rejects a file over the size limit", () => {
    const result = validateAttachment({
      type: "image/png",
      size: MAX_ATTACHMENT_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/large|size|limit/i);
    }
  });

  it("accepts a supported image at exactly the size limit", () => {
    const result = validateAttachment({
      type: "image/png",
      size: MAX_ATTACHMENT_BYTES,
    });
    expect(result.ok).toBe(true);
  });
});

describe("resizeImage", () => {
  it("shrinks an image whose long edge exceeds the limit", async () => {
    const oversized = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: { r: 90, g: 110, b: 130 },
      },
    })
      .png()
      .toBuffer();

    const resized = await resizeImage(oversized, "image/png");
    const meta = await sharp(resized.bytes).metadata();

    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(
      MAX_IMAGE_EDGE_PX,
    );
  });

  it("leaves an image already within the limit unchanged in dimensions", async () => {
    const small = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const resized = await resizeImage(small, "image/png");
    const meta = await sharp(resized.bytes).metadata();

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
