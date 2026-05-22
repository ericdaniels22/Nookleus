// Attachment storage for Jarvis Chat attachments (#198, #199).
//
// Owns the `jarvis-attachments` bucket: the object path shape, plus
// upload / load / conversation-prefix delete. Keeping the path shape in
// one place means a conversation delete can wipe every attachment under
// `{organization_id}/{conversation_id}/` with a single prefix sweep.

import type { SupportedImageType } from "./normalize";
import type { AttachmentResolver } from "./content-blocks";

// Media types the bucket stores — images (#198) plus PDF (#199).
export type AttachmentMediaType = SupportedImageType | "application/pdf";

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
  "application/pdf": "pdf",
};

// File extension for an attachment's media type — used to name the stored
// object. Falls back to `bin` for anything unrecognised.
export function extensionForMediaType(mediaType: string): string {
  return EXTENSION_BY_MEDIA_TYPE[mediaType] ?? "bin";
}

// Upload one normalized image or PDF into the bucket under the
// conversation's prefix. Returns the object path to store inline on the
// message.
export async function uploadAttachment(
  supabase: StorageClient,
  params: {
    orgId: string;
    conversationId: string;
    mediaType: AttachmentMediaType;
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

// An AttachmentResolver that loads image bytes from the bucket but
// refuses any reference outside the caller's Organization — an
// attachment path always begins with its owning org id. A cross-org or
// org-less reference throws, so `buildClaudeMessages` degrades that
// attachment to a text note rather than ever loading another tenant's
// image. Shared by the chat route and the three department routes
// (#201) so the org-scoping check lives in exactly one place. Only
// image attachments hit the resolver — a PDF rides by its file_id and
// never touches storage (#199).
export function orgScopedImageResolver(
  supabase: StorageClient,
  orgId: string | null,
): AttachmentResolver {
  return async (attachment) => {
    if (!orgId || !attachment.storage_path.startsWith(`${orgId}/`)) {
      throw new Error("Attachment outside caller's organization");
    }
    return {
      base64: await loadAttachmentBase64(supabase, attachment.storage_path),
      mediaType: attachment.media_type,
    };
  };
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
