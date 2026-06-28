// The maximum length (in characters — ≈ bytes for the mostly-ASCII HTML these
// templates hold) of a stored template body. A template body flows into other
// members' outgoing mail and can carry inline base64 images, so an uncapped
// write is both a storage and a delivery hazard. Generous enough for a
// logo-bearing template; anything beyond it is rejected before storage so the
// route never issues an oversized write. (Issue #660.)
export const MAX_TEMPLATE_BODY_HTML_LENGTH = 512 * 1024;
