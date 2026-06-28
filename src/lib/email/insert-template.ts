// Template-insertion math for the compose editor (issue #644 / PRD #634).
// Picking an email template drops its body HTML into the message — without
// clobbering what the user already typed or the signature region below it.
// Kept pure and free of React/Tiptap so the splice logic can be unit-tested in
// isolation, mirroring the sibling signature-swap module.

import { findSignatureRegion } from "./signature-swap";

/** Whether a stretch of body HTML carries no real content — the placeholder an
 *  empty editor renders ("<p></p>", "<p><br></p>", a whitespace/`&nbsp;`-only
 *  paragraph). An image counts as content even though it has no text. */
function isEmptyBodyHtml(html: string): boolean {
  if (/<img\b/i.test(html)) return false;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, "")
    .trim();
  return text.length === 0;
}

/** Return `bodyHtml` with `templateHtml` inserted into the message region:
 *  just above the signature region when one exists (so the signature stays at
 *  the bottom), otherwise appended after the existing content. The user's typed
 *  content and the entire signature region are preserved.
 *
 *  Region detection is shared with the signature-swap path (issue #656): both
 *  rely on the single `findSignatureRegion` matcher, so neither can be fooled by
 *  pasted email HTML that merely contains the marker substring. We only need
 *  where the region BEGINS — the template is spliced just above it.
 *
 *  When the message part above the region is just the empty-editor placeholder,
 *  it is dropped rather than kept, so a template inserted into a fresh editor
 *  doesn't open the message with a stray leading empty paragraph (issue #660). */
export function insertTemplateBody(
  bodyHtml: string,
  templateHtml: string,
): string {
  const region = findSignatureRegion(bodyHtml);
  const messagePart = region ? bodyHtml.slice(0, region.start) : bodyHtml;
  const rest = region ? bodyHtml.slice(region.start) : "";
  const head = isEmptyBodyHtml(messagePart) ? "" : messagePart;
  return head + templateHtml + rest;
}
