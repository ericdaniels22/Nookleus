// PRD #304 — Nookleus Phone. Slice 9 (#313) — voice-recordings bucket I/O.
//
// Owns the `phone-recordings` bucket (migration-313): path shape + upload +
// signed-URL minting, mirroring attachments-storage (slice 6). Org-scoping is
// enforced at the path level — every object lives under `{organization_id}/` —
// and double-enforced by the Storage read policy installed alongside the
// bucket. Voicemail audio is copied out of Twilio as MP3 so it outlives
// Twilio's media retention and plays directly in the browser <audio> element.

export const PHONE_RECORDINGS_BUCKET = "phone-recordings";

// Voicemail audio is always stored as MP3 (we fetch Twilio's `.mp3` variant).
const RECORDING_EXT = "mp3";
const RECORDING_CONTENT_TYPE = "audio/mpeg";

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
export interface PhoneRecordingStorageClient {
  storage: { from(bucket: string): BucketClient };
}

// {organization_id}/{uuid}.{ext} — flat under the org id (Phone has no
// per-conversation sweep), matching phoneAttachmentPath.
export function phoneRecordingPath(
  orgId: string,
  uuid: string,
  ext: string,
): string {
  return `${orgId}/${uuid}.${ext}`;
}

export interface UploadRecordingParams {
  orgId: string;
  bytes: Buffer | Uint8Array;
}

export async function uploadPhoneRecording(
  client: PhoneRecordingStorageClient,
  params: UploadRecordingParams,
): Promise<{ storagePath: string }> {
  const uuid = crypto.randomUUID();
  const storagePath = phoneRecordingPath(params.orgId, uuid, RECORDING_EXT);
  const { error } = await client.storage
    .from(PHONE_RECORDINGS_BUCKET)
    .upload(storagePath, params.bytes, {
      contentType: RECORDING_CONTENT_TYPE,
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload phone recording: ${error.message}`);
  }
  return { storagePath };
}

export async function signedUrlForPhoneRecording(
  client: PhoneRecordingStorageClient,
  storagePath: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await client.storage
    .from(PHONE_RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    throw new Error(
      `Failed to sign phone recording URL: ${error?.message ?? "no url"}`,
    );
  }
  return data.signedUrl;
}
