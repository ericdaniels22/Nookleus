// Claude content-block assembly for Jarvis Chat attachments (#198).
//
// Turns the JarvisMessage history into the Anthropic message-params
// array: text stays text, an attached image becomes a base64 image
// content block. A reference-to-source resolver is injected so this is
// testable without touching storage.

import type Anthropic from "@anthropic-ai/sdk";
import type { JarvisAttachment, JarvisMessage } from "@/lib/types";

export interface ResolvedImage {
  base64: string;
  mediaType: string;
}

// Resolves a stored attachment reference to the base64 bytes Claude needs.
export type AttachmentResolver = (
  attachment: JarvisAttachment,
) => Promise<ResolvedImage>;

export async function buildClaudeMessages(
  history: JarvisMessage[],
  resolveImage: AttachmentResolver,
): Promise<Anthropic.MessageParam[]> {
  return Promise.all(
    history.map(async (message) => {
      if (!message.attachment) {
        return { role: message.role, content: message.content };
      }

      let resolved: ResolvedImage;
      try {
        resolved = await resolveImage(message.attachment);
      } catch {
        // The image is gone or unreadable — degrade to text so Jarvis can
        // still respond and tell the user the attachment is unavailable.
        const note = "[An image was attached here but could not be loaded.]";
        const text = message.content.trim()
          ? `${message.content}\n\n${note}`
          : note;
        return { role: message.role, content: text };
      }

      const content: Anthropic.ContentBlockParam[] = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type:
              resolved.mediaType as Anthropic.Base64ImageSource["media_type"],
            data: resolved.base64,
          },
        },
      ];
      // An empty text block is rejected by the API — a message may carry
      // just an image with no caption.
      if (message.content.trim().length > 0) {
        content.push({ type: "text", text: message.content });
      }
      return { role: message.role, content };
    }),
  );
}
