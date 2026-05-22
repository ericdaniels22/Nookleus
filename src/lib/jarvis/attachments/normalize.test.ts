import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  validateAttachment,
  resizeImage,
  MAX_ATTACHMENT_BYTES,
  MAX_PDF_BYTES,
  MAX_IMAGE_EDGE_PX,
} from "./normalize";

// Issue #198 — a user attaches one image to a Jarvis Core message. The
// normalization module is the gate: it decides what counts as an
// attachable image before anything reaches storage or Claude.
//
// Issue #199 extends the gate to PDFs (up to 32 MB, no resize).

describe("validateAttachment", () => {
  it("accepts a supported image type", () => {
    const result = validateAttachment({ type: "image/jpeg", size: 1024 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("image");
  });

  it("rejects an unsupported type with a clear error", () => {
    const result = validateAttachment({
      type: "text/plain",
      size: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/text\/plain/i);
      expect(result.error).toMatch(/image|pdf/i);
    }
  });

  it("accepts a PDF", () => {
    const result = validateAttachment({
      type: "application/pdf",
      size: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("pdf");
      expect(result.mediaType).toBe("application/pdf");
    }
  });

  it("rejects a PDF over the 32MB limit", () => {
    const result = validateAttachment({
      type: "application/pdf",
      size: MAX_PDF_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/large|size|limit/i);
      expect(result.error).toMatch(/pdf/i);
    }
  });

  it("accepts a PDF at exactly the 32MB limit", () => {
    const result = validateAttachment({
      type: "application/pdf",
      size: MAX_PDF_BYTES,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("pdf");
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
