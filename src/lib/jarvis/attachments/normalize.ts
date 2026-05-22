// Attachment normalization for Jarvis Chat attachments (#198, #199).
//
// The gate between a user-picked file and the rest of the pipeline:
// it validates the file is an attachable image or PDF and resizes large
// images so they sit within Claude's vision sweet spot. PDFs are passed
// through unresized (#199).

import sharp from "sharp";

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export const PDF_MEDIA_TYPE = "application/pdf";

// Image upload ceiling. Resizing brings the long edge down to
// MAX_IMAGE_EDGE_PX, so anything that clears this cap ends up comfortably
// inside Claude's per-image limit by the time it is sent.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// PDF upload ceiling — Claude's document limit (#199). PDFs are not
// resized, so this cap is the only size gate they get.
export const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MB

// Claude's vision models read an image at full detail up to ~1568px on the
// long edge; past that the image is downsampled anyway. Resizing here keeps
// the bytes small without losing anything Claude would have used.
export const MAX_IMAGE_EDGE_PX = 1568;

export type ValidationResult =
  | { ok: true; kind: "image"; mediaType: SupportedImageType }
  | { ok: true; kind: "pdf"; mediaType: typeof PDF_MEDIA_TYPE }
  | { ok: false; error: string };

export function validateAttachment(file: {
  type: string;
  size: number;
}): ValidationResult {
  if ((SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
      return {
        ok: false,
        error: `That image is too large — keep images under ${mb} MB.`,
      };
    }
    return {
      ok: true,
      kind: "image",
      mediaType: file.type as SupportedImageType,
    };
  }

  if (file.type === PDF_MEDIA_TYPE) {
    if (file.size > MAX_PDF_BYTES) {
      const mb = Math.round(MAX_PDF_BYTES / (1024 * 1024));
      return {
        ok: false,
        error: `That PDF is too large — keep PDFs under ${mb} MB.`,
      };
    }
    return { ok: true, kind: "pdf", mediaType: PDF_MEDIA_TYPE };
  }

  const label = file.type || "that file";
  return {
    ok: false,
    error: `${label} isn't a supported attachment — attach a JPEG, PNG, GIF, or WebP image, or a PDF.`,
  };
}

// Resize an image so its long edge is at most MAX_IMAGE_EDGE_PX. Smaller
// images are returned untouched (`withoutEnlargement`). The output keeps the
// input format, so an animated GIF stays an animated GIF.
export async function resizeImage(
  bytes: Buffer | Uint8Array,
  mediaType: SupportedImageType,
): Promise<{ bytes: Buffer; mediaType: SupportedImageType }> {
  const resized = await sharp(bytes, { animated: true })
    .resize({
      width: MAX_IMAGE_EDGE_PX,
      height: MAX_IMAGE_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();
  return { bytes: resized, mediaType };
}
