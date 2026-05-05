// Build 67c2 — wrap user-edited plain-text body back into HTML before sending.
// Pairs with html-to-text.ts. The user types in a textarea (text), but
// outgoing emails are HTML for consistency with payments + contracts.
//
// Anything the user pastes is treated as text — pasted HTML is escaped, not
// rendered. This is intentional and safer than parsing arbitrary pasted HTML.

export function textToHtml(text: string): string {
  // 1. HTML-escape the five special chars
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // 2. Split into paragraphs on blank lines, each paragraph wraps in <p>,
  //    single line breaks become <br>.
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);

  return paragraphs.join("\n");
}
