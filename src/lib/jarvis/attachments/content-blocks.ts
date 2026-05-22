// Claude content-block assembly for Jarvis Chat attachments (#198, #199, #200).
//
// Turns the JarvisMessage history into the Anthropic message-params
// array: text stays text, each attached image becomes a base64 image
// content block, and each attached PDF becomes a document block that
// references its Anthropic Files API file_id. A message may carry several
// attachments (#200), so every one is mapped, in order, ahead of the text.
//
// A reference-to-source resolver is injected for images so this is
// testable without touching storage; a PDF needs no resolver because its
// file_id rides inline on the reference (so a replayed PDF is never
// re-encoded).
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

function imageBlock(
  resolved: ResolvedImage,
): Anthropic.Beta.BetaImageBlockParam {
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
// failed upload) throws, degrading that attachment to a text note.
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

// An unreadable attachment degrades to a text note so Jarvis can still
// answer and explain it is unavailable — without dropping the readable
// attachments on the same message.
function degradeNote(failedImages: number, failedPdfs: number): string {
  const parts: string[] = [];
  if (failedImages > 0) {
    parts.push(failedImages === 1 ? "an image" : `${failedImages} images`);
  }
  if (failedPdfs > 0) {
    parts.push(failedPdfs === 1 ? "a PDF" : `${failedPdfs} PDFs`);
  }
  const phrase = parts.join(" and ");
  return `[${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} attached here could not be loaded.]`;
}

export async function buildClaudeMessages(
  history: JarvisMessage[],
  resolveImage: AttachmentResolver,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  return Promise.all(
    history.map(async (message): Promise<Anthropic.Beta.BetaMessageParam> => {
      const attachments = message.attachments ?? [];
      if (attachments.length === 0) {
        return { role: message.role, content: message.content };
      }

      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      let failedImages = 0;
      let failedPdfs = 0;
      for (const attachment of attachments) {
        try {
          content.push(
            attachment.kind === "pdf"
              ? documentBlock(attachment)
              : imageBlock(await resolveImage(attachment)),
          );
        } catch {
          // This attachment is gone or unreadable. Drop it but keep going
          // so the other attachments on the message still reach Claude.
          if (attachment.kind === "pdf") failedPdfs++;
          else failedImages++;
        }
      }

      let text = message.content.trim();
      if (failedImages > 0 || failedPdfs > 0) {
        const note = degradeNote(failedImages, failedPdfs);
        text = text ? `${text}\n\n${note}` : note;
      }
      // An empty text block is rejected by the API — a message may carry
      // just attachments with no caption.
      if (text.length > 0) {
        content.push({ type: "text", text });
      }
      return { role: message.role, content };
    }),
  );
}
