# Build 15h — Post-Sign Confirmation Emails + Orphan Cleanup (design)

Date: 2026-05-07
Build: 15h (second slice of the 25b carve-out from 15d; first slice was 15e)

## Problem

When a multi-signer contract reaches "all signers signed," the new (15d)
overlay-PDF flow stamps the PDF, uploads it, and flips
`contracts.status = "signed"` — but it does not send anyone a copy.

Concretely:

- The customer who just signed sees the "Thank you, you've signed" page and
  walks away with no record of what they agreed to.
- The org (you) gets no notification that a contract just completed; the
  only signal today is `contracts.next_reminder_at` advancing or polling the
  job page manually.
- The legacy orphan route at `src/app/api/contracts/[id]/sign/route.ts`
  (475 lines, no current callers) still contains the email-send logic.
  It's been kept around since 15d as the source of truth for unported
  features. After 15h ships, it can be deleted.

The sibling route `POST /api/contracts/in-person` has the same gap.

## Scope

This spec covers three tightly-coupled changes:

1. **Customer confirmation email** — one per signer, with the signed PDF
   attached, when all signers have signed.
2. **Internal confirmation email** — one per contract, to the org's
   recipient (typically the reply-to address), with the signed PDF
   attached.
3. **Orphan deletion** — remove `src/app/api/contracts/[id]/sign/route.ts`,
   `src/app/api/contracts/[id]/regenerate-pdf/route.ts`, and
   `src/lib/contracts/pdf.ts` (685 lines), plus the dead `postinstall`
   step in `package.json` that copies the pdfjs worker into `/public/`
   (replaced by bundler resolution in 15e).

Both signing flows — public emailed link (`POST /api/sign/[token]`) and
in-person iPad (`POST /api/contracts/in-person`) — get the same email
behaviour. They currently duplicate ~60 lines of stamp-and-flip logic;
this build extracts that into a shared helper that also owns the email
dispatch, eliminating the duplication.

Out of scope:

- **Regenerate-signed-PDF endpoint** — explicitly cut. Editing a signed
  legal artifact carries content-modification risk under ESIGN/UETA;
  rebuild is "void + re-sign" instead. The orphan
  `regenerate-pdf/route.ts` is deleted with no replacement.
- **Reminder scheduling** — already shipped in 15e; no change here.
- **`partially_signed` status enum** — open chip from 15d; out of scope.
- **`contract_email_settings` auto-row-on-org-create** — open chip from
  15d; out of scope.
- **Tiptap link-validate hardening** — open chip from 15g; out of scope.

## Behaviour

When the last signer of a contract submits successfully (`allSigned ===
true` in either signing route), after the existing stamp + upload +
status-flip block:

1. Send one customer confirmation email per `contract_signers` row, in
   `signer_order`. Each goes to that signer's `email`. Body and subject
   come from `contract_email_settings.signed_confirmation_subject_template`
   / `signed_confirmation_body_template`. The signed PDF is attached.
2. Send one internal confirmation email. Recipient resolution via the
   existing `resolveInternalRecipient(settings, emailAccountAddress)`
   helper:
   - For Resend (AAA's setup today):
     `settings.reply_to_email || settings.send_from_email`. AAA's row
     currently resolves to `eric@aaacontracting.com`.
   - For SMTP/email_account: the connected mailbox address (looked up
     via a `SELECT email_address FROM email_accounts WHERE id =
     settings.email_account_id`).
   Body and subject come from
   `contract_email_settings.signed_confirmation_internal_subject_template`
   / `signed_confirmation_internal_body_template`. The signed PDF is
   attached. The `contract_platform_url` merge extra is set to
   `${appUrl()}/jobs/${contract.job_id}` so the internal template can
   link back to the job.
3. Each send writes a `contract_events` audit row of type
   `email_delivered`. On success: `metadata = { kind: "customer_confirmation",
   signer_id: <id> }` (per-signer) or `{ kind: "internal_confirmation" }`.
   On failure: same `kind` plus `error: <message>`. Failures do not
   surface to the signer who just clicked Sign and do not roll back the
   already-completed status flip.

The PDF attachment is constructed once per contract from the in-memory
`stamped` bytes already produced by `stampPdf`; we do not re-download
from storage. Filename = `${sanitize(contract.title)}.pdf` where
`sanitize` strips `\\/:*?"<>|`.

For single-signer contracts, the customer-email loop runs exactly once
(one signer in the array). For 2-signer contracts, it runs twice.

## Architecture

### New shared helper: `src/lib/contracts/finalize.ts`

A single export, `finalizeSignedContract`, owns the post-final-signer
pipeline. Inputs:

```ts
interface FinalizeArgs {
  supabase: SupabaseClient;     // service client
  contract: Contract;
  template: ContractTemplate;
  signers: ContractSigner[];    // ordered by signer_order, all signed
  customerInputs: Record<string, string | boolean>;
  signedAt: Date;
}
```

Behaviour, in order:

1. Download all signature PNGs from `contract-pdfs` storage (existing
   inline code).
2. Download the source template PDF (existing inline code).
3. Resolve merge values via `resolveMergeValues(supabase, contract.job_id,
   { signedAt })` (existing inline code).
4. Call `stampPdf(...)` with the same arg shape used today (existing
   inline code).
5. Upload the stamped PDF to
   `${contract.organization_id}/contracts/${contract.id}-signed.pdf` in
   `contract-pdfs` (existing inline code).
6. `UPDATE contracts SET status='signed', signed_pdf_path=<path>,
   signed_at=<signedAt>` (existing inline code).
7. Load `contract_email_settings` for the org. If missing, write an
   `email_delivered` audit row with
   `metadata = { kind: "customer_confirmation", error:
   "contract_email_settings row missing" }` and return — skip both email
   loops.
8. For each signer in order: resolve the customer template via
   `resolveEmailTemplate`, send via `sendContractEmail` with the PDF
   attached, write success or failure audit row. Each signer is its own
   try/catch — one signer's failure does not block the next signer's
   send.
9. Resolve the internal recipient (with the email_account address
   lookup if applicable), resolve the internal template (passing
   `contract_platform_url`), send, write audit row. Same try/catch
   isolation.
10. Return the stamped PDF path. The caller does nothing with the
    return today; reserved for future use.

The helper is the **only** place that:

- Calls `stampPdf` for the all-signed terminal case.
- Calls `mark_contract_signed`-style status flips (today this is a
  direct `UPDATE`; we keep that).
- Calls `sendContractEmail` for the customer/internal pair.

### Caller refactor

Both `POST /api/sign/[token]` and `POST /api/contracts/in-person`
currently inline the stamp pipeline (~60 lines each). Both are rewritten
to:

```ts
if (allSigned && template.pdf_storage_path) {
  await finalizeSignedContract({
    supabase, contract, template, signers: refreshedSigners,
    customerInputs: mergedInputs, signedAt,
  });
}
```

The next-signer-handoff branch in `/api/sign/[token]` (15e logic) is
unchanged — it runs only when `!allSigned` and is not part of finalize.
The signed-event audit row (the existing `writeContractEvent` of type
`signed`) stays in the route, written after `finalizeSignedContract`
returns.

### Why a helper, not duplicated code

The two routes already share ~60 duplicate lines for the stamp pipeline
alone; adding ~80 more lines of email-dispatch logic to both would push
the duplication past the point where they will reliably stay in sync.
The helper is small (≤200 lines), single-purpose, and tested via the
two route call sites.

## Audit events

All audit rows use the existing `email_delivered` event type. No schema
change. `metadata` shape:

| When                          | metadata                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Customer email success        | `{ kind: "customer_confirmation", signer_id: <id>, provider, message_id }`       |
| Customer email failure        | `{ kind: "customer_confirmation", signer_id: <id>, error: <message> }`           |
| Internal email success        | `{ kind: "internal_confirmation", provider, message_id }`                        |
| Internal email failure        | `{ kind: "internal_confirmation", error: <message> }`                            |
| Settings row missing (skip)   | `{ kind: "customer_confirmation", error: "contract_email_settings row missing" }`|

The `provider` and `message_id` come from `sendContractEmail`'s return
value (`SendResult`). Today's code path discards them; this build
captures them for forensics. Existing 15e next-signer-handoff audit
shape (`{ kind: "next_signer_activation", error: ... }`) is unchanged.

## Error handling

Two principles:

1. **The signing operation is "done" before any email fires.** The PDF
   is stamped, the row is flipped to `signed`, the `contract_signers`
   row is updated, and the `contract_events` row of type `signed` is
   written, all before `finalizeSignedContract` returns. If anything
   inside finalize after the status flip throws, the contract is still
   in the correct state — only the emails are missing, and the audit
   trail records why.

2. **Each email is independent.** A bad address on signer 2 does not
   block signer 1's confirmation, and neither blocks the internal
   email. Three try/catch boundaries: customer-loop body, internal
   block, and an outer guard around the entire post-status-flip section.

If `contract_email_settings` is missing for the org, finalize writes one
audit row noting the skip and returns. This matches the 15e behaviour
on the same condition.

If `sendContractEmail` itself raises before reaching the provider (e.g.
empty `to` address), the error message is captured verbatim in the
audit row.

## Orphan deletion

After finalize is wired into both routes and verified end-to-end, three
files are deleted in their own commit:

- `src/app/api/contracts/[id]/sign/route.ts` (475 lines, no callers)
- `src/app/api/contracts/[id]/regenerate-pdf/route.ts` (100 lines, no
  callers)
- `src/lib/contracts/pdf.ts` (685 lines, only consumer was the two
  orphan routes above)

Plus a small `package.json` cleanup: the `postinstall` step that copies
`pdf.worker.min.mjs` into `/public/` is dead since the 15e bundler-
resolution fix. The `/public/pdf.worker.min.mjs` file produced by the
postinstall is also dead and gets deleted from the repo if present.

The matcher exemption in `src/proxy.ts` for `pdf.worker.min.mjs` is
**kept** — bundler-emitted worker URLs route through `_next/static/`
which is already exempt, so the explicit exemption is harmless, but
removing it would re-introduce the proxy 307 risk if anything ever
served a static-public worker path again. Keep it.

## Pre-flight verification

Before writing code, the implementer confirms (one Supabase MCP call):

```sql
SELECT organization_id, send_from_email, reply_to_email, provider,
       length(signed_confirmation_subject_template) > 0 as has_cust_subj,
       length(signed_confirmation_body_template) > 0 as has_cust_body,
       length(signed_confirmation_internal_subject_template) > 0 as has_int_subj,
       length(signed_confirmation_internal_body_template) > 0 as has_int_body
FROM contract_email_settings
WHERE organization_id = '<AAA org id>';
```

Both AAA and Test Co should return non-empty templates for all four
columns (the seed migration `build15b_contract_email_settings_seed` or
similar populated them at row-creation; recent runtime UPDATE in 15e
only changed the from/reply addresses, not the templates). If a row is
missing or has empty template strings, fix at runtime via Supabase MCP
`execute_sql` UPDATE before testing — same playbook as 15e.

## Testing plan

End-to-end smoke against AAA prod, mirroring 15e's recipe with the
addition of inbox checks and audit-row checks:

1. Create a 2-signer test contract via the existing template (e.g. the
   WTR template `60862e63...`), attached to a real-looking job.
2. Send to signer 1 — verify the request email arrives unchanged.
3. Sign as signer 1 in the browser. Confirm signer 1 receives only the
   handoff email to signer 2 (15e behaviour); no confirmation yet.
4. Sign as signer 2 in the browser.
5. **Inbox checks:**
   - Signer 1's inbox: `signed_confirmation` email with attached signed
     PDF named after `contract.title`.
   - Signer 2's inbox: same.
   - `eric@aaacontracting.com`: internal confirmation with attached
     signed PDF.
6. **PDF verification:** open each attachment; confirm it contains both
   signatures stamped at the expected coordinates and all merge fields
   resolved.
7. **Audit-row check** via Supabase MCP:
   ```sql
   SELECT event_type, metadata, created_at
   FROM contract_events
   WHERE contract_id = '<test contract id>'
     AND event_type = 'email_delivered'
   ORDER BY created_at;
   ```
   Expect three success rows: two `customer_confirmation` (with distinct
   `signer_id`) plus one `internal_confirmation`. None should have an
   `error` key.
8. **In-person flow:** create a second 2-signer test contract, sign
   both signers via the iPad route. Re-run inbox + audit checks.
   Expect identical 3-email pattern.
9. **Failure path:** corrupt one signer's email in the DB to a
   guaranteed-bouncing address (e.g.
   `bounce@simulator.amazonses.com` or a malformed string). Sign the
   final signer. Confirm:
   - The contract still flips to `signed`.
   - The bad signer's audit row has `error: <message>`.
   - The other signer's email and the internal email both succeed.
   Restore the signer's email address after.
10. **Cleanup:** delete the 2 test contracts + their stamped PDFs from
    AAA prod, same recipe used after 15d Task 29.

Orphan deletion happens **after** steps 1–10 pass and is a separate
commit. If a regression surfaces between merge and orphan-deletion, the
orphan files are still on disk to compare against.

## Risks

- **Resend daily-send limit.** AAA's plan caps sends per day. A
  2-signer contract triggers up to 5 sends total (1 initial request, 1
  handoff, 2 customer confirmations, 1 internal). For real contract
  volume this is well within limits, but a stress test (e.g., 50
  contracts in a day) could hit the cap. Mitigation: the per-send audit
  trail makes the cause obvious; same risk exists in 67c2's
  estimate/invoice send flows.
- **Same email on customer + internal recipient.** If an org's
  reply-to address matches one of the signer addresses, that person
  gets two emails (one as signer, one as internal). The orphan code
  did not deduplicate; we don't either. Documented behaviour.
- **Large attachment.** Resend's attachment limit is 40 MB total per
  email; signed PDFs from the WTR template are ~290 KB. Well below.
  The internal-confirmation merge field `contract_platform_url` is
  surfaced in the body, so the internal recipient can fall back to the
  platform link if Resend ever did reject the attachment.
- **Helper extraction breaks one route silently.** Both routes are
  rewritten in the same commit, but a divergence in how each builds
  the inputs to `finalizeSignedContract` (e.g., one passes pre-merged
  inputs, the other re-merges) could let a bug ship under the smoke
  test if the two routes are not exercised symmetrically. Mitigation:
  the helper takes one explicit `FinalizeArgs` shape with no implicit
  defaults; the smoke test exercises both routes (steps 1–8 cover the
  remote flow, step 8 covers in-person).

## Decisions locked

- **Customer email goes to every signer, not just the primary.** Rationale:
  homeowner + spouse pattern; each party expects a record. Cost: one
  extra Resend send per multi-signer contract.
- **In-person flow sends the same emails as the remote flow.** Rationale:
  industry standard (DocuSign, HelloSign); customer expects an email
  receipt regardless of how they signed.
- **No regenerate-PDF endpoint.** Rationale: editing a signed legal
  artifact is content-modification under ESIGN/UETA; the safe path is
  void + re-sign. The orphan is deleted with no replacement.
- **Best-effort emails; signing succeeds even on email failure.**
  Rationale: customer-facing reliability beats notification reliability;
  the audit trail makes recovery possible.
- **Audit on success captures `provider` + `message_id`.** Rationale:
  forensics. Today's 15e audit rows only capture failures; this build
  symmetrizes.
- **Shared `finalizeSignedContract` helper rather than duplicated
  inline code.** Rationale: two routes already share ~60 duplicate
  lines; adding ~80 more lines to both pushes drift risk past the
  point of staying in sync.

## Links

- 15d implementation: `docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md`
- 15e (next-signer handoff): `docs/superpowers/specs/2026-05-07-multi-signer-next-signer-email-handoff-design.md`
- Orphan source of truth: `src/app/api/contracts/[id]/sign/route.ts` lines 372–458 (the post-final-signer email block)
- Send helper: `src/lib/contracts/email.ts` (`sendContractEmail`,
  `resolveInternalRecipient`)
- Stamp helper: `src/lib/contracts/stamp-pdf.ts`
- Email template resolver: `src/lib/contracts/email-merge-fields.ts`
