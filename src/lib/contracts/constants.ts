// Build 15d: PDF-overlay templates resolve merge values at sign time
// (inside stampPdf), not at draft creation. The legacy `filled_content_html`
// column on `contracts` is retained NOT NULL for pre-15d rows, so new
// PDF-overlay contracts pass empty string + its sha256 to satisfy the schema.
export const EMPTY_HTML = "";
export const EMPTY_HTML_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
