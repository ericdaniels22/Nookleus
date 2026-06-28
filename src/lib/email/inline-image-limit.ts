// Size cap for inline base64 images dropped into the compose body (issue #660).
// A pasted screenshot or photo can be several megabytes once base64-encoded, and
// that payload rides along in every autosave POST and the final sent email —
// bloating both. Kept pure (no React/Tiptap) so the size logic is unit-testable;
// the compose editor enforces it by rejecting oversized images with a toast.

/** Per-image decoded-byte ceiling. ~1 MB of actual image data is generous for an
 *  inline logo/screenshot while still blocking multi-megabyte photo dumps. */
export const MAX_INLINE_IMAGE_BYTES = 1024 * 1024;

const BASE64_DATA_URL = /^data:[^;,]*;base64,([\s\S]*)$/i;

/** Decoded byte length of a base64 payload, derived from its character length
 *  (4 base64 chars → 3 bytes) minus any '=' padding — no decoding required. */
export function base64ByteLength(base64: string): number {
  const len = base64.length;
  if (len === 0) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/** Whether an image `src` is an inline base64 data URL whose decoded payload
 *  exceeds {@link MAX_INLINE_IMAGE_BYTES}. Remote URLs and missing srcs are never
 *  oversized — they don't carry their bytes inline. */
export function isOversizedInlineImage(
  src: string | null | undefined,
): boolean {
  if (!src) return false;
  const match = BASE64_DATA_URL.exec(src);
  if (!match) return false;
  return base64ByteLength(match[1]) > MAX_INLINE_IMAGE_BYTES;
}
