// Template-insertion math for the compose editor (issue #644 / PRD #634).
// Picking an email template drops its body HTML into the message — without
// clobbering what the user already typed or the signature region below it.
// Kept pure and free of React/Tiptap so the splice logic can be unit-tested in
// isolation, mirroring the sibling signature-swap module.

import { findSignatureRegion } from "./signature-swap";

/** Return `bodyHtml` with `templateHtml` inserted into the message region:
 *  just above the signature region when one exists (so the signature stays at
 *  the bottom), otherwise appended after the existing content. The user's typed
 *  content and the entire signature region are preserved.
 *
 *  Region detection is shared with the signature-swap path (issue #656): both
 *  rely on the single `findSignatureRegion` matcher, so neither can be fooled by
 *  pasted email HTML that merely contains the marker substring. We only need
 *  where the region BEGINS — the template is spliced just above it. */
export function insertTemplateBody(
  bodyHtml: string,
  templateHtml: string,
): string {
  const region = findSignatureRegion(bodyHtml);
  if (region) {
    return (
      bodyHtml.slice(0, region.start) + templateHtml + bodyHtml.slice(region.start)
    );
  }
  return bodyHtml + templateHtml;
}
