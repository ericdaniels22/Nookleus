// Storage path builders — one function per bucket×type. Every upload call
// site should import from here rather than concatenating strings inline so
// all paths pick up the org prefix consistently.
//
// Path shapes mirror the post-18a layout (org id prefix + the same
// suffix that existed pre-18a). See scripts/migrate-storage-paths.ts and
// build50's storage_paths_swap_to_new() for the one-time rename that
// brought pre-18a objects into this shape.

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

// email-attachments — per account, per email, per file.
export function emailAttachmentPath(
  orgId: string,
  accountId: string,
  emailId: string,
  filename: string,
): string {
  return `${orgId}/${accountId}/${emailId}/${filename}`;
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
