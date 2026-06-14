// Template-insertion math for the compose editor (issue #644 / PRD #634).
// Picking an email template drops its body HTML into the message — without
// clobbering what the user already typed or the signature region below it.
// Kept pure and free of React/Tiptap so the splice logic can be unit-tested in
// isolation, mirroring the sibling signature-swap module.

import { SIGNATURE_BLOCK_ATTR } from "./signature-swap";

// Matches the opening tag of the delimited signature region (see signature-swap).
// We only need where the region BEGINS — the template is spliced in just above
// it, so the whole signature block stays intact at the bottom of the message.
const REGION_OPEN_RE = new RegExp(
  `<div\\b[^>]*\\b${SIGNATURE_BLOCK_ATTR}\\b[^>]*>`,
  "i",
);

/** Return `bodyHtml` with `templateHtml` inserted into the message region:
 *  just above the signature region when one exists (so the signature stays at
 *  the bottom), otherwise appended after the existing content. The user's typed
 *  content and the entire signature region are preserved. */
export function insertTemplateBody(
  bodyHtml: string,
  templateHtml: string,
): string {
  const open = REGION_OPEN_RE.exec(bodyHtml);
  if (open) {
    return bodyHtml.slice(0, open.index) + templateHtml + bodyHtml.slice(open.index);
  }
  return bodyHtml + templateHtml;
}
