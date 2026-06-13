// PRD #304 — Nookleus Phone. Slice 13 (#317) — voicemail-greeting bucket I/O.
//
// Owns the `phone-voicemail-greetings` bucket: validation + path shape +
// upload + signed-URL minting + removal. A greeting is a short audio clip the
// inbound-voice webhook <Play>s before <Record>ing the caller. One greeting
// per number, so the object path is deterministic ({org}/{number}.{ext}) and
// upload upserts — re-recording overwrites in place.
//
// Org-scoping is enforced at the path level (every object lives under
// `{organization_id}/`) and double-enforced by the bucket's Storage policy.
//
// The column `phone_numbers.voicemail_greeting_url` stores this storage PATH,
// not a public URL: the bucket is private and the webhook mints a fresh signed
// URL per call, so no long-lived signed URL is ever persisted.

// Structural slice of the Supabase Storage client — only the calls these
// helpers make. Mirrors attachments-storage so the two stay interchangeable.
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
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: StorageError | null }>;
}
export interface VoicemailGreetingStorageClient {
  storage: { from(bucket: string): BucketClient };
}

export const PHONE_VOICEMAIL_GREETINGS_BUCKET = "phone-voicemail-greetings";

// Twilio's <Play> verb accepts a narrow set of audio formats — mp3 and wav are
// the practical two. The record-in-browser UI encodes WAV precisely because
// the browser's native MediaRecorder (webm/ogg) is NOT <Play>-compatible, so
// we reject everything else here rather than fail silently at call time.
const GREETING_EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

// Greetings are short; cap the upload so a mistaken large file is rejected
// before it ever reaches the bucket. 5 MB covers a couple minutes of WAV.
export const VOICEMAIL_GREETING_MAX_BYTES = 5 * 1024 * 1024;

export type VoicemailGreetingValidation =
  | { ok: true; ext: string; contentType: string }
  | { ok: false; error: string };

// Validate an uploaded greeting by MIME type + size. Returns the storage
// extension to use on success so the caller never re-derives it.
export function validateVoicemailGreeting(input: {
  type: string;
  size: number;
}): VoicemailGreetingValidation {
  const ext = GREETING_EXT_BY_TYPE[input.type];
  if (!ext) {
    return {
      ok: false,
      error:
        "Unsupported audio format — a voicemail greeting must be MP3 or WAV.",
    };
  }
  if (input.size <= 0) {
    return { ok: false, error: "Empty audio file." };
  }
  if (input.size > VOICEMAIL_GREETING_MAX_BYTES) {
    return { ok: false, error: "Audio file is too large (max 5 MB)." };
  }
  return { ok: true, ext, contentType: input.type };
}

// {organization_id}/{number_id}.{ext} — one greeting per number, so the path
// is deterministic and the object upserts on re-record.
export function voicemailGreetingPath(
  orgId: string,
  numberId: string,
  ext: string,
): string {
  return `${orgId}/${numberId}.${ext}`;
}

export interface UploadGreetingParams {
  orgId: string;
  numberId: string;
  ext: string;
  contentType: string;
  bytes: Buffer | Uint8Array;
}

export async function uploadVoicemailGreeting(
  client: VoicemailGreetingStorageClient,
  params: UploadGreetingParams,
): Promise<{ storagePath: string }> {
  const storagePath = voicemailGreetingPath(
    params.orgId,
    params.numberId,
    params.ext,
  );
  const { error } = await client.storage
    .from(PHONE_VOICEMAIL_GREETINGS_BUCKET)
    .upload(storagePath, params.bytes, {
      contentType: params.contentType,
      // Re-recording a greeting overwrites the number's single object.
      upsert: true,
    });
  if (error) {
    throw new Error(`Failed to upload voicemail greeting: ${error.message}`);
  }
  return { storagePath };
}

export async function signedUrlForVoicemailGreeting(
  client: VoicemailGreetingStorageClient,
  storagePath: string,
  expiresInSeconds: number,
): Promise<string> {
  const { data, error } = await client.storage
    .from(PHONE_VOICEMAIL_GREETINGS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    throw new Error(
      `Failed to sign voicemail greeting URL: ${error?.message ?? "no url"}`,
    );
  }
  return data.signedUrl;
}

// Best-effort delete of a greeting object (clearing or replacing). Storage
// `remove` is idempotent — removing a missing path is not an error — so the
// caller can clear the column even if the object was already gone.
export async function removeVoicemailGreeting(
  client: VoicemailGreetingStorageClient,
  storagePath: string,
): Promise<void> {
  const { error } = await client.storage
    .from(PHONE_VOICEMAIL_GREETINGS_BUCKET)
    .remove([storagePath]);
  if (error) {
    throw new Error(`Failed to remove voicemail greeting: ${error.message}`);
  }
}
