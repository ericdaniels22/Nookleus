# Finalize signed contract — refactor design

**Status:** spec, ready to execute
**Author:** Eric Daniels (with Claude in `/improve-codebase-architecture`)
**Date:** 2026-05-13

## Why we're doing this

`src/lib/contracts/finalize.ts` owns the post-final-signer pipeline: stamp the signed PDF, upload it, flip the contract status to `signed`, send confirmation emails. It works in the happy path. Three problems make it dangerous as the product matures:

1. **Silent status-flip failure.** The `contracts.update(...)` call at line 108 has no error check. If it fails for any reason (RLS denial, network blip, constraint violation), the function continues and dispatches "your contract is signed" emails while the database still shows the contract unsigned. The caller returns 200. Reviewers flagged this as IMPORTANT during the 15h session and it was deferred for plan-fidelity reasons.

2. **No retry safety.** If the route layer retries (network drop between the Supabase write and the HTTP response), the function runs again. The PDF re-upload is idempotent and the status flip is idempotent, but **emails get sent twice**. Customer gets two "thanks for signing" emails, internal address gets two notifications.

3. **Audit trail is internally inconsistent.** Three nested try/catches write `contract_events` rows on failure, but the row's `metadata.kind` depends on which catch caught the throw. The outer guard always writes `kind: "customer_confirmation"` even if the failure was in the internal-email section or elsewhere entirely. The "settings missing" branch writes one row labeled customer_confirmation and never records that the internal email was also skipped. A future audit reader can't tell what actually happened.

This refactor closes all three.

## What changes

One exported function in the same file. Same name (`finalizeSignedContract`). Same callers. Different shape inside.

### New behavior

**Idempotency at the entry point.** The function's first action is to read the current `contracts.status`. If the contract is already `signed`, it returns immediately with `wasAlreadyFinalized: true` and the existing `signed_pdf_path`. No re-stamping, no re-flipping, no emails. Retries are safe.

**Error-checked status flip.** The `contracts.update(...)` call now checks its error. If the update fails, the function throws — same way it already throws when stamp-PDF download fails, etc. Emails are never dispatched on a failed flip.

**Structured return value.** Today the function returns `{ signedPdfPath }`. After this change it returns:

```ts
{
  signedPdfPath: string;
  wasAlreadyFinalized: boolean;       // true when the function detected
                                       // an already-signed contract and no-op'd
  notifications: {
    summary: { sent: number; failed: number; skipped: number };
    outcomes: Array<{
      recipient: "customer" | "internal";
      signerId?: string;               // present when recipient === "customer"
      to: string | null;               // null when skipped before resolving address
      result:
        | { status: "sent"; provider: string; messageId: string }
        | { status: "failed"; error: string }
        | { status: "skipped"; reason: "settings_missing" | "no_internal_recipient" | "no_signer_email" };
    }>;
  };
}
```

When `wasAlreadyFinalized` is true, `notifications.outcomes` is empty and `summary` is all zeros. The PDF path returned is the existing one from the database.

**Unified audit-row contract.** Every intended recipient produces exactly one `contract_events` row of type `email_delivered`. The row's `metadata.kind` is `"customer_confirmation"` for customer emails and `"internal_confirmation"` for the internal email. The row's `metadata` distinguishes the three outcomes explicitly:

- **Sent:** `{ kind, signer_id?, provider, message_id }`.
- **Failed:** `{ kind, signer_id?, error }`.
- **Skipped:** `{ kind, signer_id?, skipped_reason }` — one of `settings_missing`, `no_internal_recipient`, `no_signer_email`.

When settings are missing, the function writes one skipped row per intended recipient (one per signer plus one for the internal address) rather than a single customer-confirmation row. The "what was supposed to happen" is fully recoverable from the audit log.

**Logging fallback for audit-write failures.** Today the per-row `writeContractEvent(...).catch(() => undefined)` silently swallows audit-write failures. After this change, those catches still don't throw out of finalize, but they emit a `console.error("[finalize] audit row write failed", { contractId, kind, signerId, originalOutcome, auditError })` so the failure lands in Vercel logs. This is good enough while Nookleus has no live external customers. If a long-term durable fallback is needed later, that's a separate hardening pass — out of scope here.

### Internal structure

The function splits into two private helpers in the same file:

- **`sealContract(args)`** — stamps the PDF, uploads it, flips status. Throws on any failure. Returns `{ signedPdfPath, stampedPdfBytes }`. Pure transactional; no email logic.
- **`dispatchNotifications(supabase, contract, signers, pdfAttachment)`** — sends all emails. Never throws out. Returns the `notifications` block from the return shape above. Writes audit rows internally as it goes.

The public `finalizeSignedContract` becomes a thin orchestrator: check `contracts.status` → early-return if already signed → call `sealContract` → call `dispatchNotifications` → return the combined result.

Helpers stay private (not exported). The public surface remains the one function.

## What this lets us test

A new test file `src/lib/contracts/finalize.test.ts` (vitest, same pattern as the 65c tests). Tests use a fake Supabase client. The new test surface is the return value plus the contents of the `contract_events` rows written during the call.

Tests this refactor unlocks (cannot be written against the current code):

- `finalize_throws_when_status_flip_fails` — Supabase update returns an error → function throws, no emails sent, no notification rows written.
- `finalize_returns_no_op_when_contract_already_signed` — pre-existing `status: 'signed'` → function returns `wasAlreadyFinalized: true`, no stamp work performed, no emails sent.
- `finalize_dispatch_report_matches_audit_rows` — two signers, one customer email succeeds, the other bounces → return value reports `{ sent: 2, failed: 1, skipped: 0 }` (one customer + one internal sent, one customer failed), and three rows land in `contract_events` with matching outcomes.
- `finalize_skipped_rows_when_settings_missing` — `contract_email_settings` row absent → function still seals the contract, return value reports all recipients skipped with `reason: "settings_missing"`, and one audit row per intended recipient lands in `contract_events`.
- `finalize_no_internal_recipient_resolved` — settings exist but `resolveInternalRecipient` returns null → return value reports internal as skipped with `reason: "no_internal_recipient"`, audit row matches.
- `finalize_signer_with_null_email_is_skipped` — signer record has null `email` → that customer outcome is `skipped` with `reason: "no_signer_email"`, other signers and the internal email still attempt.

Tests that already work today (and need to keep working):

- `finalize_seals_and_sends_in_happy_path` — already exercised by the 15h Task 5 and Task 6 live smoke; needs a unit-test equivalent now that the test surface allows it.

## What touches what

**Files modified:**

- `src/lib/contracts/finalize.ts` — the refactor itself. Internal split into helpers, new return shape, idempotency check, error-checked update, unified audit rows.
- `src/app/api/sign/[token]/route.ts` — caller. Today: ignores the return value beyond the PDF path. After: same, unless we decide to log the notification report (recommended: log `result.notifications.summary` so failed emails surface in Vercel logs without changing response shape). No change to the HTTP response.
- `src/app/api/contracts/in-person/route.ts` — same as above.

**Files added:**

- `src/lib/contracts/finalize.test.ts` — the test file described above.

**Files NOT touched** (deliberate scope cuts):

- `src/lib/contracts/audit.ts` — `writeContractEvent` keeps its existing signature. The unified audit-row shape is achieved by passing different metadata, not by changing the writer.
- `src/lib/contracts/email.ts`, `src/lib/contracts/stamp-pdf.ts`, `src/lib/contracts/resolve-merge-values.ts`, `src/lib/contracts/email-merge-fields.ts` — unchanged.
- 15e next-signer-handoff path — separate concern, already working.
- Manual email-resend flow for failed deliveries — out of scope. The "we sent the contract but the email failed, please resend" UI is a future, separate feature. Today the audit log is the recovery surface (someone reads it and manually triggers a resend through the same routes or a future admin tool).

**Database:** no migrations. The `contract_events` table accepts arbitrary JSON in `metadata`; no schema change needed.

## Order of work

The split is small enough to ship in one session, but the natural ordering inside it:

1. Add the idempotency check at the top of `finalizeSignedContract` (read status, early-return if signed). Smallest change; lets us test that path first.
2. Add the error check to the status-flip update. One line; closes the silent-failure bug.
3. Extract `sealContract` private helper. Pure mechanical refactor; no behavior change.
4. Extract `dispatchNotifications` private helper. Same.
5. Refactor `dispatchNotifications` to return the structured outcomes list and write the unified audit-row metadata. Per-recipient outcome shape lands here.
6. Wire the new return shape through `finalizeSignedContract`. Update the `FinalizeResult` type.
7. Update both callers (`sign/[token]` route, `in-person` route) to log `result.notifications.summary` if any failed/skipped. No HTTP response change.
8. Write `finalize.test.ts` with the test list above.

Steps 1–2 are the load-bearing safety fixes and could even ship as their own commit if you want them separated from the structural refactor.

## Risks and open questions

- **Test infrastructure for Supabase.** The 65c tests fake out Capacitor; finalize.test.ts needs a fake Supabase client supporting `.from(...).select/.update/.insert`, `.storage.from(...).download/.upload`, and the `.maybeSingle()` chain. Either build a small in-file fake (like the 65c localStorage stub) or pull in `@supabase/supabase-js`'s mock helpers. **Recommendation:** in-file fake, scoped to the calls finalize actually makes. Keeps the test file self-contained.
- **The `console.error` fallback is enough only while there are no real customers.** Once contracts are signing real money, an audit-write failure that lands only in Vercel logs is exposed: log retention is bounded and no one is watching them in real time. A future build should add a durable secondary fallback (separate table, or a structured-logging pipeline like Logflare). File for ~Build 67 or wherever the legal-record hardening lands.
- **The "already finalized" early return assumes the only way to enter `status: signed` is through this function.** If a future admin tool flips the status manually, calling finalize on that contract would return `wasAlreadyFinalized: true` without ever stamping a PDF. Today that's not a concern (no admin path exists), but worth noting.

## Decisions locked during the grilling session

- One function, not two. Routes always need both halves; splitting the function adds boilerplate without unlocking value.
- "Refuse to run twice" idempotency, not "smart retry." The function checks status and bows out cleanly. Re-sending failed emails is a separate future flow.
- Audit-row schema: medium — one row per intended recipient, always written, with a unified outcome shape. Plus `console.error` fallback if the audit write itself fails.
- Return value: rich — includes per-recipient outcomes, a summary count, and the no-op flag.
- The "already signed" case returns a normal result with the no-op flag, not an exception. Retrying a successful operation isn't an error.

## Links

- File being refactored: `src/lib/contracts/finalize.ts`
- Callers: `src/app/api/sign/[token]/route.ts`, `src/app/api/contracts/in-person/route.ts`
- Helper modules unchanged: `audit.ts`, `email.ts`, `stamp-pdf.ts`, `resolve-merge-values.ts`, `email-merge-fields.ts`
- Origin: 15h handoff `[[2026-05-07-build-15h-implementation]]` flagged the silent-update bug as an IMPORTANT reviewer finding deferred for plan-fidelity.
