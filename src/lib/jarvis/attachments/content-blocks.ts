// Claude content-block assembly for Jarvis Chat attachments (#198, #200).
//
// Turns the JarvisMessage history into the Anthropic message-params
// array: text stays text, each attached image becomes a base64 image
// content block. A message may carry several attachments (#200), so every
// one is mapped, in order, ahead of the text. A reference-to-source
// resolver is injected so this is testable without touching storage.

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

function imageBlock(resolved: ResolvedImage): Anthropic.ContentBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type:
        resolved.mediaType as Anthropic.Base64ImageSource["media_type"],
      data: resolved.base64,
    },
  };
}

export async function buildClaudeMessages(
  history: JarvisMessage[],
  resolveImage: AttachmentResolver,
): Promise<Anthropic.MessageParam[]> {
  return Promise.all(
    history.map(async (message): Promise<Anthropic.MessageParam> => {
      const attachments = message.attachments ?? [];
      if (attachments.length === 0) {
        return { role: message.role, content: message.content };
      }

      const content: Anthropic.ContentBlockParam[] = [];
      let failedCount = 0;
      for (const attachment of attachments) {
        try {
          content.push(imageBlock(await resolveImage(attachment)));
        } catch {
          // This image is gone or unreadable. Drop it but keep going so
          // the other attachments on the message still reach Claude.
          failedCount++;
        }
      }

      // A failed attachment degrades to a text note so Jarvis can still
      // answer and explain the image is unavailable.
      let text = message.content.trim();
      if (failedCount > 0) {
        const note =
          failedCount === 1
            ? "[An image was attached here but could not be loaded.]"
            : `[${failedCount} images were attached here but could not be loaded.]`;
        text = text ? `${text}\n\n${note}` : note;
      }
      // An empty text block is rejected by the API — a message may carry
      // just images with no caption.
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      return { role: message.role, content };
    }),
  );
}
