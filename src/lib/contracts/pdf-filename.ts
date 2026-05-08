// Sanitize a contract title for use as a PDF filename. Same logic the
// /api/contracts/[id]/pdf route uses for its Content-Disposition header,
// extracted so the client-side <a download="..."> attribute on the
// post-sign and contracts-list pages produces an identical filename.
export function sanitizePdfFilename(title: string): string {
  const stripped = title.replace(/[\\/:*?"<>|]/g, "_");
  // Fold unicode dashes / smart quotes to ASCII, then strip any remaining
  // non-ASCII so the filename matches the route's ASCII-safe
  // Content-Disposition fallback. Browsers writing the file from the
  // `download` attribute will use this name verbatim.
  return stripped
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, "_");
}
