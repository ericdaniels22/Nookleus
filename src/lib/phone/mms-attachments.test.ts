// PRD #304 — Nookleus Phone. Slice 6 (#310) — MMS attachments.
//
// Pure-logic gate between a user-picked attachment and the rest of the
// MMS pipeline. AC bullet:
//
//   "Per-message size enforcement: client-side rejects attachments above
//    Twilio's per-MMS size limit with a clear error before the user
//    clicks send."
//
// Twilio's hard ceiling is 5 MB total per MMS in the US/CA. We treat that
// as the per-attachment limit too (a single oversized file is rejected
// before anything else is added).

import { describe, it, expect } from "vitest";

import {
  MAX_MMS_ATTACHMENT_BYTES,
  validateMmsAttachment,
  mmsExtensionForMediaType,
  isMmsImageMediaType,
} from "./mms-attachments";

describe("validateMmsAttachment", () => {
  it("accepts a small JPEG", () => {
    const result = validateMmsAttachment({
      type: "image/jpeg",
      size: 100_000,
    });
    expect(result).toEqual({ ok: true, mediaType: "image/jpeg", kind: "image" });
  });

  it("accepts PNG / GIF / WEBP images", () => {
    for (const t of ["image/png", "image/gif", "image/webp"] as const) {
      expect(validateMmsAttachment({ type: t, size: 100 })).toEqual({
        ok: true,
        mediaType: t,
        kind: "image",
      });
    }
  });

  it("accepts a PDF as a non-image attachment", () => {
    const result = validateMmsAttachment({
      type: "application/pdf",
      size: 100_000,
    });
    expect(result).toEqual({
      ok: true,
      mediaType: "application/pdf",
      kind: "file",
    });
  });

  it("accepts a short video clip", () => {
    const result = validateMmsAttachment({
      type: "video/mp4",
      size: 100_000,
    });
    expect(result).toEqual({
      ok: true,
      mediaType: "video/mp4",
      kind: "file",
    });
  });

  it("rejects an attachment above Twilio's per-MMS size limit", () => {
    const result = validateMmsAttachment({
      type: "image/jpeg",
      size: MAX_MMS_ATTACHMENT_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too large/i);
      expect(result.error).toMatch(/5\s*MB/i);
    }
  });

  it("rejects an unsupported media type", () => {
    const result = validateMmsAttachment({
      type: "application/x-msdownload",
      size: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not.*supported|isn't.*supported/i);
    }
  });

  it("rejects when type is empty", () => {
    const result = validateMmsAttachment({ type: "", size: 100 });
    expect(result.ok).toBe(false);
  });
});

describe("isMmsImageMediaType", () => {
  it("returns true for supported image types", () => {
    expect(isMmsImageMediaType("image/jpeg")).toBe(true);
    expect(isMmsImageMediaType("image/png")).toBe(true);
    expect(isMmsImageMediaType("image/gif")).toBe(true);
    expect(isMmsImageMediaType("image/webp")).toBe(true);
  });

  it("returns false for non-image types", () => {
    expect(isMmsImageMediaType("application/pdf")).toBe(false);
    expect(isMmsImageMediaType("video/mp4")).toBe(false);
    expect(isMmsImageMediaType("")).toBe(false);
  });
});

describe("mmsExtensionForMediaType", () => {
  it("maps known image and document types to file extensions", () => {
    expect(mmsExtensionForMediaType("image/jpeg")).toBe("jpg");
    expect(mmsExtensionForMediaType("image/png")).toBe("png");
    expect(mmsExtensionForMediaType("image/gif")).toBe("gif");
    expect(mmsExtensionForMediaType("image/webp")).toBe("webp");
    expect(mmsExtensionForMediaType("application/pdf")).toBe("pdf");
    expect(mmsExtensionForMediaType("video/mp4")).toBe("mp4");
  });

  it("falls back to `bin` for an unrecognised type", () => {
    expect(mmsExtensionForMediaType("application/x-unknown")).toBe("bin");
    expect(mmsExtensionForMediaType("")).toBe("bin");
  });
});
