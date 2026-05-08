---
date: 2026-05-07
build_id: 15h
session_type: exploratory
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[build-15e]]", "[[build-15h]]"]
---

# Build 15h Handoff — 2026-05-07

## What shipped this session

- **Spec for build 15h: post-sign confirmation emails + orphan cleanup** (commit `71f6aed`). Path: `docs/superpowers/specs/2026-05-07-build-15h-post-sign-confirmation-emails-design.md`. 376 lines. Covers the second slice of the 25b carve-out from 15d (first slice was 15e's next-signer-handoff): customer + internal post-sign confirmation emails with the signed PDF attached, on both `POST /api/sign/[token]` (remote emailed-link flow) and `POST /api/contracts/in-person` (iPad in-person flow), via a shared `finalizeSignedContract` helper extracted to `src/lib/contracts/finalize.ts`. Closes the 25b carve-out by deleting three orphan files: `src/app/api/contracts/[id]/sign/route.ts` (475 lines, no callers since 15d), `src/app/api/contracts/[id]/regenerate-pdf/route.ts` (100 lines, no callers), `src/lib/contracts/pdf.ts` (685 lines, only consumer was the two orphan routes). Plus a `package.json` postinstall cleanup (the `cp pdfjs-dist/build/pdf.worker.min.mjs public/` step is dead since 15e replaced /public-served worker with bundler-resolved `new URL(..., import.meta.url)` in `configure-pdfjs.ts`) and the dead `/public/pdf.worker.min.mjs` artifact. Total ~1,260 lines of dead code removed.

- **Plan for build 15h: 11-task implementation plan** (commit `c0b4011`). Path: `docs/superpowers/plans/2026-05-07-build-15h-post-sign-confirmation-emails.md`. 981 lines. Tasks: T1 pre-flight DB check (verify `contract_email_settings` has populated templates for all four `signed_confirmation_*` columns in AAA + Test Co), T2 create the helper file (commit, no callers yet), T3 wire both signing routes to the helper in a single coordinated commit (replaces ~60 duplicated lines of inline stamp pipeline in each route with a single helper call), T4 deploy verification, T5–T7 three live smoke tests (remote/in-person/failure-path) with audit-row checks via Supabase MCP, T8 test-data cleanup using the `SET LOCAL storage.allow_delete_query='true'` admin escape from 15d Task 29, T9 delete the three orphan files (separate commit so reversible), T10 drop dead pdfjs postinstall + `/public/pdf.worker.min.mjs`, T11 final tsc/build/push + `/handoff`.

- **Major design decision locked: no regenerate-PDF endpoint.** Original brainstorm proposed all four 25b items including a "regenerate signed PDF" tool (re-stamp an already-signed contract using current code/data — would have replaced the orphan `regenerate-pdf/route.ts`). Eric questioned the legality. Determined: editing a signed legal artifact is content modification under the ESIGN Act + state UETA equivalents. The safe path for a bad-rendering PDF is **void + re-sign**, matching DocuSign / HelloSign behaviour. The orphan endpoint gets deleted with no replacement. Important downstream effect: an earlier intermediate decision in the brainstorm — "fresh re-resolve of merge values on regenerate" — was identified as carrying its own legal risk (a corrected job typo would silently change the saved signed PDF) and is moot now that regenerate is cut. Lesson preserved for future similar work: never re-derive signed-contract content from current state; treat signed PDFs as immutable.

## What's next

- **Execute build 15h's plan in a fresh session.** Run `/orient` to load the new state, point at the plan file, pick subagent-driven-development (recommended for 11 tasks). Expected duration: ~2 hours including the three live smoke tests. Plan is self-contained: pre-flight check is the first task, code commits in T2/T3 are independently reversible, orphan deletion is a separate commit at T9 so a regression in T10 (postinstall removal) can be reverted without losing the orphan-deletion progress.

- **Once 15h ships, the 25b carve-out from 15d is fully closed.** Three of the original five carve-out items are then complete (next-signer email handoff in 15e, customer confirmation email in 15h, internal confirmation email in 15h); two are intentionally cut (regenerate-PDF on legal grounds; reminder scheduling was already wired in 15e via `schedule_first_reminder` RPC). Build 15h's commit message also mentions the orphan-deletion completing the carve-out.

- **PR #48 (67e + 67f line-item title + invoice cleanup) still awaiting Eric's merge from GitHub UI.** Branch `claude/crazy-saha-20b6b1` at `f4399db`, 15 commits ahead of origin/main, all CI checks expected to be green. Separate from 15h.

## Decisions locked

- **All four 25b items in one spec.** Eric: "All four in one spec (Recommended)". Then cut regenerate-PDF, leaving three items.
- **In-person flow sends the same emails as remote.** Eric: "yes that's right" after walking through Section 1. Industry-standard (DocuSign, HelloSign) behaviour.
- **Customer email goes to every signer, not just primary.** Eric: "All signers (Recommended)". Cost: one extra Resend send per multi-signer contract; benefit: each party (homeowner + spouse) has a record.
- **Internal email goes to reply-to address.** Eric: "yes that's right" — for AAA's Resend setup, that resolves to `eric@aaacontracting.com` via `resolveInternalRecipient` fallback chain.
- **Best-effort emails; signing always succeeds even on email failure.** Eric: "yes" after walking through Section 3. Failures are logged via `email_delivered` audit rows with `error: <message>`; the signing customer never sees an error from the email path.
- **Shared `finalizeSignedContract` helper rather than duplicated inline code.** Recommended without a question gate; Eric did not push back. Eliminates ~60 lines of existing duplication between `/api/sign/[token]` and `/api/contracts/in-person` and prevents another ~80 lines of duplication when emails are added.
- **No regenerate-PDF endpoint.** Eric: "let's just not build it. I dont think its a feature i will need". After legality discussion. Orphan `regenerate-pdf/route.ts` gets deleted with no replacement.
- **Audit on success captures `provider` + `message_id`.** Symmetrizes the audit shape with the failure path; existing 15e audit only captured failures. Forensics for "did Brenda's confirmation actually go out?"

## Open threads

- **Spec + plan are unpushed locally** at session end. Eric's `/handoff` args were "then commit + push + merge" — `merge` doesn't apply on main (no PR), so the handoff commit + push will land all three (spec, plan, handoff) together.
- **Reminder cron behaviour, `partially_signed` status enum value, `contract_email_settings` auto-row-on-org-create, Tiptap link-validate hardening** — all pre-existing carve-out chips from 15d, intentionally out of scope of 15h. Carry forward.
- **The pre-flight verification SQL (Task 1) hasn't been run yet** — it's the first action of the implementation session. If any of the four template columns is empty for AAA or Test Co, the implementer fixes via runtime UPDATE before code lands, same playbook as 15e.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `c0b4011` (`plan(15h): post-sign confirmation emails + orphan cleanup`)
- **Uncommitted changes:** none (gitignored `out/` only)
- **Migrations applied this session:** none
- **Deployed to Vercel:** n/a (no code changes; only docs added)
- **Commits this session:** 2 — `71f6aed` spec, `c0b4011` plan. Both on `main`, 2 commits ahead of `origin/main` until pushed by this handoff.
- **Pulled from origin at start of session:** `0c3f16e..14edb05` — 2 commits from PR #49 (zoom controls on PDF template editor) merged into main earlier today, separate from 15h.

## Notes for next session

- **The brainstorm took a meaningful detour on the regenerate-PDF question.** Eric is non-technical and asked "is that legal to edit a completed contract?" — that one question redirected the entire scope. Default for similar future questions: explain the three buckets (visual-fix-only / content-change / gray-zone) and let Eric decide. The "fresh re-resolve" answer I'd locked in earlier in the brainstorm would have created the same content-change risk as a hand-edit; cutting regenerate eliminated both at once. Worth carrying forward: when a brainstorm question touches legal/compliance for a customer-facing artifact, escalate the framing rather than treating it as a code-organization choice.

- **The spec deliberately keeps the `src/proxy.ts` exemption for `pdf.worker.min.mjs`** even though 15h removes the `/public/` worker file. Bundler-emitted worker URLs route through `_next/static/` which is already exempt, so the explicit exemption is harmless — but removing it would re-introduce the proxy 307 risk if any future code path ever served a static-public worker again. Documented in spec § "Orphan deletion."

- **Section-by-section approval pattern worked well.** Walked Eric through 5 design sections (what fires when, what's in each email, error handling, deletion, testing) and got "yes that's right" / "yes" at each gate. He pushed back on one (regenerate-PDF) and on jargon density of the regenerate options ("Break it down it simpler way for my little brain"). Lesson: when a question is dense, reset the framing in plain English before re-asking. Don't iterate on a confused frame.

- **The plan's verification gates use `npx tsc --noEmit` + `npm run build` + live smoke** — this codebase has no unit-test framework configured, matching the 15d/15e/15f/15g pattern. Don't propose adding one unless asked; out of scope.

- **Smoke-test costs are real but small.** Three contracts × up to 5 sends each (initial request, handoff, 2 customer confirmations, 1 internal) = ~15 Resend sends for the full T5/T6/T7 sequence. Well within plan limits. The third contract (T7 failure-path) deliberately corrupts signer 2's email mid-flow; signing-URL-recovery technique from 15g (`SELECT link_token FROM contracts WHERE id = '...'` + construct `/sign/<token>`) is documented in T7 step 3 to bypass the intentionally-broken signer-2 inbox.

- **Helper-call return value is unused today** but reserved (`{ signedPdfPath: string }`). Future consumers (e.g. an admin "view stamped PDF" page) might benefit from the path being surfaced explicitly rather than re-querying `contracts.signed_pdf_path`. No work today; just documenting the deliberate shape choice.

- **The `signer_id` is written both as a column on `contract_events` AND as `metadata.signer_id`** in the customer-confirmation audit rows. Slightly redundant but the column-write enables `WHERE signer_id = ...` queries and the metadata copy matches the spec table verbatim. Don't deduplicate.

## Links

- Build card: [[build-15h]] (to be created — first session for this build)
- Spec: `docs/superpowers/specs/2026-05-07-build-15h-post-sign-confirmation-emails-design.md`
- Plan: `docs/superpowers/plans/2026-05-07-build-15h-post-sign-confirmation-emails.md`
- Current state: [[00-NOW]]
- Related: [[2026-05-07-build-15e]] (the first slice of the 25b carve-out, shipped earlier today), [[2026-05-06-build-15d-implementation]] (where the 25b carve-out was originally created)
