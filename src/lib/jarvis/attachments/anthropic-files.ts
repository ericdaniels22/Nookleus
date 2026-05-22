// Anthropic Files API integration for Jarvis Chat attachments (#199).
//
// A PDF is uploaded to the Anthropic Files API once, on attach. The
// returned file_id is stored inline on the attachment reference and
// reused as a document `file` source on every replay — so a PDF is
// encoded and uploaded exactly once, never re-sent byte-for-byte.

import Anthropic, { toFile } from "@anthropic-ai/sdk";

// Beta required for the Anthropic Files API: file uploads, and `file`
// document sources on the Messages API. Both the attachments route (which
// uploads) and the Jarvis chat route (which references file_ids) send it.
export const ANTHROPIC_FILES_BETA = "files-api-2025-04-14";

// Upload a PDF's bytes to the Anthropic Files API and return its file_id.
// Throws if the upload fails — the caller treats that as a failed attach.
export async function uploadPdfToAnthropic(
  anthropic: Anthropic,
  pdf: { bytes: Buffer | Uint8Array; filename: string },
): Promise<string> {
  const uploadable = await toFile(pdf.bytes, pdf.filename, {
    type: "application/pdf",
  });
  const result = await anthropic.beta.files.upload({
    file: uploadable,
    betas: [ANTHROPIC_FILES_BETA],
  });
  return result.id;
}
