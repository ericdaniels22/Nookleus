// #606 — pure shaping of a Showcase into the WordPress post body.
//
// The publish route resolves the Showcase's ordered photo ids to public
// Supabase URLs and hands them here with the write-up; the result is the post
// `content` HTML. Kept separate from the REST client (wordpress.ts) so the
// markup is pure and independently testable. Photos are hot-linked, not
// uploaded to the WordPress media library.

// Escape the five HTML-significant characters so admin-typed text and URLs land
// as data, never markup. Covers both text and double-quoted attribute contexts.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ShowcaseBodyInput {
  writeUp: string;
  // Ordered, public photo URLs — gallery order is meaningful.
  photoUrls: string[];
}

export function renderShowcaseBodyHtml(input: ShowcaseBodyInput): string {
  const paragraphs = input.writeUp
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");

  const figures = input.photoUrls
    .map(
      (url) =>
        `<figure><img src="${escapeHtml(url)}" alt="Project photo" /></figure>`,
    )
    .join("\n");

  return [paragraphs, figures].filter((s) => s.length > 0).join("\n");
}
