// PRD #304 — Nookleus Phone. Slice 6 (#310) — MMS attachments.
//
// Pure-logic helpers for the MMS attachment pipeline: size + content-type
// gating, plus the media-type → file-extension map used by both the
// outbound storage path and the inbound copy-to-storage step.
//
// Kept narrow on purpose — every other module in the slice composes over
// these helpers. The size ceiling is Twilio's hard 5 MB MMS limit; the
// supported list is the intersection of "Twilio will deliver" and "the
// inline thread render or a download chip can handle". Anything outside
// that list is rejected at the client *and* the server.

export const MAX_MMS_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export const MMS_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type MmsImageMediaType = (typeof MMS_IMAGE_MEDIA_TYPES)[number];

const MMS_FILE_MEDIA_TYPES = [
  "application/pdf",
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
] as const;

export type MmsFileMediaType = (typeof MMS_FILE_MEDIA_TYPES)[number];

export type MmsMediaType = MmsImageMediaType | MmsFileMediaType;

export type MmsValidationResult =
  | { ok: true; kind: "image"; mediaType: MmsImageMediaType }
  | { ok: true; kind: "file"; mediaType: MmsFileMediaType }
  | { ok: false; error: string };

export function isMmsImageMediaType(type: string): type is MmsImageMediaType {
  return (MMS_IMAGE_MEDIA_TYPES as readonly string[]).includes(type);
}

function isMmsFileMediaType(type: string): type is MmsFileMediaType {
  return (MMS_FILE_MEDIA_TYPES as readonly string[]).includes(type);
}

export function validateMmsAttachment(file: {
  type: string;
  size: number;
}): MmsValidationResult {
  if (file.size > MAX_MMS_ATTACHMENT_BYTES) {
    const mb = Math.round(MAX_MMS_ATTACHMENT_BYTES / (1024 * 1024));
    return {
      ok: false,
      error: `That file is too large — keep attachments under ${mb} MB.`,
    };
  }
  if (isMmsImageMediaType(file.type)) {
    return { ok: true, kind: "image", mediaType: file.type };
  }
  if (isMmsFileMediaType(file.type)) {
    return { ok: true, kind: "file", mediaType: file.type };
  }
  return {
    ok: false,
    error: `${file.type || "That file"} isn't a supported attachment.`,
  };
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
};

export function mmsExtensionForMediaType(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "bin";
}
