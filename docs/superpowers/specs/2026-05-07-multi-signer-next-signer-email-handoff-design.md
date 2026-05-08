# Build 15e — Multi-Signer Next-Signer Email Handoff (design)

Date: 2026-05-07
Build: 15e (carve-out from 25b — first slice)

## Problem

When signer 1 of a multi-signer contract submits via the public remote-link
flow (`POST /api/sign/[token]`), nothing happens for signer 2. The contract
sits with signer 1's signature recorded and signer 2 never receives an
email — the only way to reach signer 2 is the legacy admin/in-person route
`POST /api/contracts/[id]/sign`, which 15d Test 10 used as a workaround.

Result: every multi-signer contract sent through the new (15d) overlay-PDF
flow stalls after signer 1. The product cannot ship multi-signer to
customers until the handoff exists in the public route.

## Scope

This spec covers **only** the next-signer email handoff. Out of scope (still
deferred to later 15e/25b slices):

- Customer + internal post-sign confirmation emails with attached signed PDF.
- Reminder scheduling at initial send (already shipped in `/api/contracts/send`).
- Regenerate-signed-PDF endpoint.
- `partially_signed` contract status enum value.
- `contract_email_settings` auto-row-on-org-create.

## Behaviour

After signer N (N < total signers) submits successfully via
`POST /api/sign/[token]`:

1. Load the org's `contract_email_settings` row.
2. Pick the lowest `signer_order` whose `signed_at` is null — that's the
   "next" signer.
3. Compute `expiresAt` = now + clamp(`default_link_expiry_days`, 1, 30) days.
4. Generate a fresh signing JWT (`generateSigningToken`) for the next signer.
5. Call the `activate_next_signer(p_contract_id, p_next_signer_id, p_link_token, p_link_expires_at)` RPC, which atomically rotates `contracts.link_token` and writes a `'link_activated'` audit event.
6. Resolve `signing_request_subject_template` + `signing_request_body_template` via `resolveEmailTemplate` with the new signing link.
7. Send via `sendContractEmail` (Resend or SMTP, per the org's settings).
8. Schedule the first reminder via `schedule_first_reminder` RPC if `computeInitialNextReminderAt(now, reminder_day_offsets)` returns a date.

This mirrors the existing implementation in
`src/app/api/contracts/[id]/sign/route.ts:228-296` (the legacy route's
remote-mode branch). No new RPCs, helpers, or schema changes are required.

## Failure modes

The signer N submission has already succeeded by the time this code runs
(signature PNG uploaded, `contract_signers.signed_at` set, signed audit
event written). The handoff is therefore wrapped in a single try/catch:

- On any failure (settings missing, RPC error, email send error), write a
  `email_delivered` audit event with metadata `{ kind: "next_signer_activation", error: "<message>" }` and continue. Do not return an error to the signer who just signed.
- Signer N's `POST /api/sign/[token]` response remains `{ ok: true, all_signed: false }` — the user-facing contract is signed by them; the failed handoff is recoverable via admin tooling (Resend the contract from the contract detail page, which re-runs the same code path on the legacy route).

This is identical to the legacy route's posture: the customer-visible
operation is the priority; the next-signer email is best-effort.

## Non-changes

- The all-signed branch (`if (allSigned && template.pdf_storage_path)`,
  current lines 203-254) is untouched in this slice. Confirmation emails
  are a separate 15e slice.
- The in-person route (`POST /api/contracts/[id]/sign`) is untouched.
- No new env vars, no migrations, no schema changes.

## Testing notes

End-to-end smoke against prod Vercel requires Resend domain verification at
`resend.com/domains` so two distinct recipients (signer 1 + signer 2) can
both receive mail in the same flow. Without verification, sends to
non-account-owner addresses are rejected by Resend.

Type-check + Vercel build is the unit of verification this session. The
e2e smoke for two-signer flow is gated on Resend verification; if Eric has
verified `aaadr.com` (or whichever domain) and has two real addresses to
test against, we can smoke immediately. Otherwise the implementation lands
behind the same flag and we smoke when domain verification is done.

## Risk

Low. The block being added is a near-line-for-line port of code that has
been running in `/api/contracts/[id]/sign` since Build 15c. The data model
is identical (same tables, same RPCs, same email helpers). The only
adaptation is which file the code lives in.
