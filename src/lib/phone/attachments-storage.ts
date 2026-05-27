// PRD #304 — Nookleus Phone. Slice 6 (#310) — MMS attachments bucket I/O.
//
// Owns the `phone-attachments` bucket: path shape + upload + signed-URL
// minting. Org-scoping is enforced at the path level — every object lives
// under `{organization_id}/` — and double-enforced by the Storage read
// policy installed alongside the bucket.

import { mmsExtensionForMediaType, type MmsMediaType } from "./mms-attachments";

export const PHONE_ATTACHMENTS_BUCKET = "phone-attachments";

// Structural slice of the Supabase Storage client — only the calls these
// helpers make.
interface StorageError {
  message: string;
}
interface BucketClient {
  upload(
    path: string,
    body: Buffer | Uint8Array | ArrayBuffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: unknown; error: StorageError | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{ data: { signedUrl: string } | null; error: StorageError | null }>;
}
export interface PhoneStorageClient {
  storage: { from(bucket: string): BucketClient };
}

// {organization_id}/{uuid}.{ext} — Phone has no conversation-prefix sweep
// (phone conversations aren't user-deletable), so the path stays flat
// under the org id.
export function phoneAttachmentPath(
  orgId: string,
  uuid: string,
  ext: string,
): string {
  return `${orgId}/${uuid}.${ext}`;
}

export interface UploadParams {
  orgId: string;
  mediaType: MmsMediaType;
  bytes: Buffer | Uint8Array;
}

export async function uploadPhoneAttachment(
  client: PhoneStorageClient,
  params: UploadParams,
): Promise<{ storagePath: string; mediaType: MmsMediaType }> {
  const uuid = crypto.randomUUID();
  const ext = mmsExtensionForMediaType(params.mediaType);
  const storagePath = phoneAttachmentPath(params.orgId, uuid, ext);
  const { error } = await client.storage
    .from(PHONE_ATTACHMENTS_BUCKET)
    .upload(storagePath, params.bytes, {
      contentType: params.mediaType,
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload phone attachment: ${error.message}`);
  }
  return { storagePath, mediaType: params.mediaType };
}

export async function signedUrlForPhoneAttachment(
  client: PhoneStorageClient,
  storagePath: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await client.storage
    .from(PHONE_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    throw new Error(
      `Failed to sign phone attachment URL: ${error?.message ?? "no url"}`,
    );
  }
  return data.signedUrl;
}
