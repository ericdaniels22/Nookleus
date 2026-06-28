import { describe, it, expect } from "vitest";
import {
  MAX_INLINE_IMAGE_BYTES,
  base64ByteLength,
  isOversizedInlineImage,
} from "./inline-image-limit";

describe("base64ByteLength", () => {
  it("derives the decoded byte length from a base64 payload's length", () => {
    // "TWFu" decodes to "Man" (3 bytes); padding shrinks the decoded size.
    expect(base64ByteLength("TWFu")).toBe(3);
    expect(base64ByteLength("TWE=")).toBe(2);
    expect(base64ByteLength("TQ==")).toBe(1);
    expect(base64ByteLength("")).toBe(0);
  });
});

describe("isOversizedInlineImage", () => {
  it("never flags a remote (non-data) image URL", () => {
    expect(isOversizedInlineImage("https://example.com/logo.png")).toBe(false);
    expect(isOversizedInlineImage(undefined)).toBe(false);
    expect(isOversizedInlineImage(null)).toBe(false);
  });

  it("allows a small inline base64 image", () => {
    const small = `data:image/png;base64,${"A".repeat(8)}`;
    expect(isOversizedInlineImage(small)).toBe(false);
  });

  it("flags an inline base64 image whose decoded size exceeds the cap", () => {
    // 4 base64 chars carry 3 decoded bytes, so to clear the byte cap we need a
    // payload a third longer than the cap.
    const payload = "A".repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES + 1) * (4 / 3)));
    const big = `data:image/png;base64,${payload}`;
    expect(isOversizedInlineImage(big)).toBe(true);
  });
});
