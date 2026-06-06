# Signed contract PDFs are immutable

**Status:** Accepted
**Date:** 2026-06-05 — documents a decision made during Build 15d–15h (May 2026)

## Context

When the final signer signs a contract, the server stamps the signer signature
PNGs and field values onto the uploaded template PDF with pdf-lib
(`src/lib/contracts/stamp-pdf.ts`), uploads the result to the private
`contract-pdfs` bucket, records it as `contracts.signed_pdf_path`, and flips
`contracts.status` to `signed` (Build 15d). **That stamped file is the executed
legal record from then on** — the bytes are not re-derived later.

During the build-out, a legacy stack of orphan routes survived:
`api/contracts/[id]/sign/route.ts`, `api/contracts/[id]/regenerate-pdf/route.ts`,
and a legacy HTML→PDF builder `src/lib/contracts/pdf.ts`. The
`regenerate-pdf` endpoint (≈100 lines, no callers) could re-render a contract's
PDF from current template/data. In the Build 15h brainstorm we had an explicit
legality discussion and decided **not** to offer a regenerate feature at all
("let's just not build it"); the orphan endpoint was deleted with no replacement.

## Decision

1. **A signed contract PDF is immutable.** Once a contract is `signed`, the PDF
   stamped and stored at signing time is the legal record and is **never
   regenerated** from the current template or data. There is deliberately **no
   regenerate-signed-PDF endpoint**, and one should not be added.

2. **The finalize pipeline is idempotent at the entry point.**
   `finalizeSignedContract` / `sealContract`'s first action is to read
   `contracts.status`; if it is already `signed`, it returns immediately with
   `wasAlreadyFinalized: true` and the existing `signed_pdf_path` — no
   re-stamping, no status re-flip, no re-sent emails. The principle is **"refuse
   to run twice" idempotency, not "smart retry."** A retry of a successful sign
   must never produce a different or new PDF.

## Consequences

- **Re-rendering a signed PDF would be content modification of a signed legal
  artifact under the ESIGN Act / UETA.** Re-deriving the bytes from the current
  template or data could silently change what the parties actually agreed to and
  signed, destroying the evidentiary integrity of the executed document.
  Freezing the at-signing PDF preserves exactly what was presented and signed.
- **Template, branding, or data changes after signing do not touch already-signed
  contracts** — their PDFs keep their original appearance, which is correct for a
  historical legal record. This mirrors the "existing generated PDFs are not
  regenerated" stance for photo reports ([ADR 0009](0009-photo-reports-are-an-in-job-narrative-document.md),
  [ADR 0003](0003-single-photo-report-layout.md)).
- **Any future "fix a signed contract" need must go through a new document or
  amendment flow**, never by editing the signed bytes.
- **The audit trail backing signed records is itself part of the legal record.**
  Today an audit-write failure only lands in Vercel logs via `console.error`.
  That is acceptable only while there are no real paying customers; once real
  contracts sign real money, a durable secondary fallback is owed (legal-record
  hardening, slated around Build 67).

## Considered options

- **Build a regenerate-PDF endpoint.** Rejected on legal grounds — editing a
  signed artifact is content modification under ESIGN/UETA. ("let's just not
  build it.")
- **Keep the orphan `regenerate-pdf` endpoint dormant for later.** Rejected: dead
  code that invites misuse on a legal artifact. Deleted outright.
- **Regenerate-on-read from the stored field values.** Rejected: same legal
  problem as an explicit endpoint, plus rendering drift if the PDF renderer
  changes over time.
