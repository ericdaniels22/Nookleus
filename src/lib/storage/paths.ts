// Storage path builders — one function per bucket×type. Every upload call
// site should import from here rather than concatenating strings inline so
// all paths pick up the org prefix consistently.
//
// Path shapes mirror the post-18a layout (org id prefix + the same
// suffix that existed pre-18a). See scripts/migrate-storage-paths.ts and
// build50's storage_paths_swap_to_new() for the one-time rename that
// brought pre-18a objects into this shape.

// Fold a user-supplied filename into a single, Supabase-key-safe segment.
//
// Supabase Storage rejects any object key containing a character outside its
// `isValidKey` whitelist with a 400 "Invalid key". The most common offender
// is the em dash (—, U+2014) that mail clients auto-insert into subjects and
// attachment names — e.g. "Work Authorization — Michelle Baker.pdf" fails to
// upload. We whitelist a conservative subset of that charset (alphanumerics,
// dot, underscore, hyphen) so the output is *always* a valid key, and keep the
// original human-readable name in attachment metadata / the download
// Content-Disposition for display. Anything else collapses to "_".
export function sanitizeStorageFilename(filename: string): string {
  // A filename is a single key segment — drop any path separators an attacker
  // or odd client might smuggle in (handles both "/" and Windows "\").
  const base = filename.split(/[/\\]/).pop() ?? "";
  // Keep the final extension intact; sanitize stem and ext independently.
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1) : "";

  const fold = (s: string) =>
    s
      // café → cafe: decompose, then drop the combining diacritics.
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // Any run of disallowed chars (incl. whitespace) → one underscore.
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "");

  const safeStem = fold(stem) || "file";
  const safeExt = fold(ext).replace(/[^A-Za-z0-9]+/g, "");
  return safeExt ? `${safeStem}.${safeExt}` : safeStem;
}

// photos — photos bucket. Per-contact folders.
export function photoPath(orgId: string, contactId: string, filename: string): string {
  return `${orgId}/${contactId}/${filename}`;
}

// receipts — PDF receipts generated after Stripe payment.
export function receiptPath(orgId: string, contactId: string, paymentRequestId: string): string {
  return `${orgId}/${contactId}/${paymentRequestId}.pdf`;
}

// contracts — signed PDFs.
export function contractPdfPath(orgId: string, contactId: string, contractId: string): string {
  return `${orgId}/${contactId}/${contractId}.pdf`;
}

// contracts — signer signature images (one per signer).
export function contractSignaturePath(
  orgId: string,
  contactId: string,
  contractId: string,
  signerOrder: number,
): string {
  return `${orgId}/${contactId}/${contractId}/signatures/${signerOrder}.png`;
}

// reports — photo report PDFs. Keyed off the job number (human-readable).
export function reportPath(orgId: string, jobNumber: string, reportId: string): string {
  return `${orgId}/${jobNumber}/${reportId}.pdf`;
}

// email-attachments — per account, per email, per file. The filename comes
// straight from the user's compose box or an inbound message's MIME part, so
// it routinely carries em dashes / smart punctuation that Supabase rejects —
// sanitize it into a safe key segment.
export function emailAttachmentPath(
  orgId: string,
  accountId: string,
  emailId: string,
  filename: string,
): string {
  return `${orgId}/${accountId}/${emailId}/${sanitizeStorageFilename(filename)}`;
}

// job-files — generic job attachments.
export function jobFilePath(orgId: string, contactId: string, fileId: string, filename: string): string {
  return `${orgId}/${contactId}/${fileId}-${filename}`;
}

// marketing-assets — timestamped per-tenant asset library.
export function marketingAssetPath(orgId: string, timestamp: string, slug: string, ext: string): string {
  return `${orgId}/${timestamp}-${slug}.${ext}`;
}

// company-assets — logos, signature images, etc.
export function companyAssetPath(orgId: string, filename: string): string {
  return `${orgId}/${filename}`;
}

// expense receipts — uploaded by crew during expense entry.
export function expenseReceiptPath(orgId: string, expenseId: string, filename: string): string {
  return `${orgId}/${expenseId}/${filename}`;
}

// user profile photos.
export function profilePhotoPath(orgId: string, userId: string, ext: string): string {
  return `${orgId}/${userId}.${ext}`;
}

// estimate / invoice generated PDFs — pdfs bucket, canonical path overwrites on each export.
export function estimatePdfPath(orgId: string, jobNumber: string, estimateNumber: string): string {
  return `${orgId}/${jobNumber}/${estimateNumber}.pdf`;
}
export function invoicePdfPath(orgId: string, jobNumber: string, invoiceNumber: string): string {
  return `${orgId}/${jobNumber}/${invoiceNumber}.pdf`;
}
