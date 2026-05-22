// Claude content-block assembly for Jarvis Chat attachments (#198, #199).
//
// Turns the JarvisMessage history into the Anthropic message-params
// array: text stays text, an attached image becomes a base64 image
// content block, and an attached PDF becomes a document block that
// references its Anthropic Files API file_id. A reference-to-source
// resolver is injected for images so this is testable without touching
// storage; a PDF needs no resolver because its file_id rides inline on
// the reference (so a replayed PDF is never re-encoded).
//
// The result is typed against the beta message params: a document block
// with a `file` source is a beta-only feature, so the Jarvis routes call
// `anthropic.beta.messages.create` with the files-api beta.

import type Anthropic from "@anthropic-ai/sdk";
import type { JarvisAttachment, JarvisMessage } from "@/lib/types";

export interface ResolvedImage {
  base64: string;
  mediaType: string;
}

// Resolves a stored image attachment reference to the base64 bytes Claude
// needs. Only images are resolved — a PDF carries its file_id inline.
export type AttachmentResolver = (
  attachment: JarvisAttachment,
) => Promise<ResolvedImage>;

export async function buildClaudeMessages(
  history: JarvisMessage[],
  resolveImage: AttachmentResolver,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  return Promise.all(
    history.map(async (message) => {
      const attachment = message.attachment;
      if (!attachment) {
        return { role: message.role, content: message.content };
      }

      let attachmentBlock: Anthropic.Beta.BetaContentBlockParam;
      try {
        attachmentBlock =
          attachment.kind === "pdf"
            ? documentBlock(attachment)
            : imageBlock(await resolveImage(attachment));
      } catch {
        // The image or PDF is gone or unreadable — degrade to text so
        // Jarvis can still respond and tell the user it is unavailable.
        return {
          role: message.role,
          content: degradedText(message.content, attachment.kind),
        };
      }

      const content: Anthropic.Beta.BetaContentBlockParam[] = [attachmentBlock];
      // An empty text block is rejected by the API — a message may carry
      // just an attachment with no caption.
      if (message.content.trim().length > 0) {
        content.push({ type: "text", text: message.content });
      }
      return { role: message.role, content };
    }),
  );
}

function imageBlock(resolved: ResolvedImage): Anthropic.Beta.BetaImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type:
        resolved.mediaType as Anthropic.Beta.BetaBase64ImageSource["media_type"],
      data: resolved.base64,
    },
  };
}

// A PDF is referenced by its Anthropic Files API file_id, so a replayed
// PDF is never re-encoded turn after turn. A reference with no file_id (a
// failed upload) throws, degrading the message to text.
function documentBlock(
  attachment: JarvisAttachment,
): Anthropic.Beta.BetaRequestDocumentBlock {
  if (!attachment.file_id) {
    throw new Error("PDF attachment has no file_id");
  }
  return {
    type: "document",
    source: { type: "file", file_id: attachment.file_id },
  };
}

function degradedText(
  content: string,
  kind: JarvisAttachment["kind"],
): string {
  const noun = kind === "pdf" ? "A PDF" : "An image";
  const note = `[${noun} was attached here but could not be loaded.]`;
  return content.trim() ? `${content}\n\n${note}` : note;
}
