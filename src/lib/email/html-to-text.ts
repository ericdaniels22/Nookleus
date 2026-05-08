// Build 67c2 — convert resolved-template HTML body to plain text for the
// send modal's <Textarea>. Templates stored in payment_email_settings are
// HTML; the modal renders text-in / HTML-out (see text-to-html.ts).
//
// Not a full HTML parser. Templates are well-formed and small. Mirrors the
// regex-based decode in src/lib/contracts/email-merge-fields.ts:48.

export function htmlToText(html: string): string {
  let s = html;

  // Block-level breaks
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n");
  s = s.replace(/<\/?p[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?div[^>]*>/gi, "\n");

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, "");

  // Decode the common five entities
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse triple-or-more newlines into double; trim
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}
