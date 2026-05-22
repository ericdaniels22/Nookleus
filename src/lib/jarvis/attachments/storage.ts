// Attachment storage for Jarvis Chat attachments (#198).
//
// Owns the `jarvis-attachments` bucket: the object path shape, plus
// upload / load / conversation-prefix delete. Keeping the path shape in
// one place means a conversation delete can wipe every attachment under
// `{organization_id}/{conversation_id}/` with a single prefix sweep.

import type { SupportedImageType } from "./normalize";

export const JARVIS_ATTACHMENTS_BUCKET = "jarvis-attachments";

// Structural subset of the Supabase storage client — just the calls this
// module makes. The real client satisfies it, and a test can supply a fake.
interface StorageError {
  message: string;
}
interface StorageBucketClient {
  list(
    path: string,
  ): Promise<{ data: { name: string }[] | null; error: StorageError | null }>;
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: StorageError | null }>;
  upload(
    path: string,
    body: Buffer | Uint8Array | ArrayBuffer,
    options?: { contentType?: string; upsert?: boolean },
  ): Promise<{ data: unknown; error: StorageError | null }>;
  download(
    path: string,
  ): Promise<{ data: Blob | null; error: StorageError | null }>;
}
export interface StorageClient {
  storage: { from(bucket: string): StorageBucketClient };
}

// {organization_id}/{conversation_id} — every attachment for one
// conversation lives under this prefix.
export function jarvisAttachmentConversationPrefix(
  orgId: string,
  conversationId: string,
): string {
  return `${orgId}/${conversationId}`;
}

// {organization_id}/{conversation_id}/{uuid}.{ext}
export function jarvisAttachmentPath(
  orgId: string,
  conversationId: string,
  uuid: string,
  ext: string,
): string {
  return `${jarvisAttachmentConversationPrefix(orgId, conversationId)}/${uuid}.${ext}`;
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

// File extension for an attachment's media type — used to name the stored
// object. Falls back to `bin` for anything unrecognised.
export function extensionForMediaType(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "bin";
}

// Upload one normalized image into the bucket under the conversation's
// prefix. Returns the object path to store inline on the message.
export async function uploadAttachment(
  supabase: StorageClient,
  params: {
    orgId: string;
    conversationId: string;
    mediaType: SupportedImageType;
    bytes: Buffer | Uint8Array;
  },
): Promise<{ storagePath: string }> {
  const uuid = crypto.randomUUID();
  const ext = extensionForMediaType(params.mediaType);
  const storagePath = jarvisAttachmentPath(
    params.orgId,
    params.conversationId,
    uuid,
    ext,
  );
  const { error } = await supabase.storage
    .from(JARVIS_ATTACHMENTS_BUCKET)
    .upload(storagePath, params.bytes, {
      contentType: params.mediaType,
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload attachment: ${error.message}`);
  }
  return { storagePath };
}

// Load a stored attachment as base64 — the form Claude's image content
// block needs. Used as the resolver source for content-block assembly.
export async function loadAttachmentBase64(
  supabase: StorageClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(JARVIS_ATTACHMENTS_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(
      `Failed to load attachment: ${error?.message ?? "not found"}`,
    );
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

// Delete every attachment under a conversation's prefix. Called when the
// conversation itself is deleted so no orphan objects linger in the bucket.
export async function deleteConversationAttachments(
  supabase: StorageClient,
  orgId: string,
  conversationId: string,
): Promise<void> {
  const prefix = jarvisAttachmentConversationPrefix(orgId, conversationId);
  const bucket = supabase.storage.from(JARVIS_ATTACHMENTS_BUCKET);

  const { data: objects, error } = await bucket.list(prefix);
  if (error) {
    throw new Error(`Failed to list attachments: ${error.message}`);
  }
  if (!objects || objects.length === 0) return;

  const paths = objects.map((object) => `${prefix}/${object.name}`);
  const { error: removeError } = await bucket.remove(paths);
  if (removeError) {
    throw new Error(`Failed to remove attachments: ${removeError.message}`);
  }
}
