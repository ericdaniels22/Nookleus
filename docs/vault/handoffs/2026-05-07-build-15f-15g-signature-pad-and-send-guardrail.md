---
date: 2026-05-07
build_id: 15f, 15g
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[2026-05-07-build-15d-cleanup-shipped]]"]
---

# Build 15f + 15g Handoff — 2026-05-07 (signature pad Type mode + send-body signing_link guard-rail)

## What shipped this session

- **Build 15f — Signature pad: thicker draw stroke + Type mode + ESIGN disclaimer.** Single-file rewrite of `src/components/contracts/signature-pad-modal.tsx` (123 → 234 lines). Three changes in one commit (`9852ee4`):
  - **Draw mode upgrade.** `lineWidth` bumped 2 → 3.5; `lineJoin = "round"` added alongside the existing `lineCap = "round"`. `move()` rewritten from `lineTo + stroke` per pointer event to quadratic-curve midpoint smoothing — for each new pointer, draw a `quadraticCurveTo(last, mid)` where `mid` is the midpoint between the last point and the new point. Standard `signature_pad`-library smoothing pattern, ~10 extra lines + one `lastPointRef`. Eliminates polyline kinks at the heavier stroke weight.
  - **Type tab.** New tabbed dialog body (Draw / Type), tabs sit above the canvas/preview area with `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` for a11y. Type tab has a text input + a 200px-tall live HTML preview rendered in **Caveat** (Google Fonts cursive face, loaded via `next/font/google` mirroring `Inter` in `app/layout.tsx:2`). Switching tabs preserves both tab states (typed text + drawn ink); the canvas re-initializes on each return to Draw because preserving canvas state across React renders inside a `hidden` tabpanel was deemed fragile and out of scope. On Insert from Type, an offscreen 600×200 canvas is created, `await document.fonts.load("60px Caveat")` is run as a font-load race guard, then the typed name is drawn via `ctx.fillText` with `textBaseline="middle"` + `textAlign="center"` and the canvas is exported as PNG via `toDataURL("image/png")`. Both tabs emit through the existing `onConfirm(dataUrl: string)` contract — **zero backend changes** (the server side `stamp-pdf.ts` + `/api/sign/[token]` POST + pdf-lib stamping path is byte-identical regardless of which tab the user signed from). Auto-shrink loop on the offscreen render — start at 60px, decrement by 4px until `measureText.width < 560` (20px padding each side), floor at 28px — handles long names like `Christopher Anderson-Whitfield-Jr` without overflowing the canvas. Pre-warm of the Caveat face at modal open via a `useEffect` so by Insert-click time the face is already in `document.fonts`.
  - **Disclaimer footer + Insert rename.** New shared footer below both tab panels with disclaimer text flush-left (`I understand this is a legal representation of my signature.` — exact HelloSign verbatim, ESIGN-aligned, no checkbox per industry norm) and Cancel + Insert buttons flush-right. The Confirm button is renamed Insert to match HelloSign vocabulary. `insertDisabled` derived: Draw mode → `!hasInk`, Type mode → `typedName.trim().length === 0`. Sole caller `src/components/contracts/contract-signer-view.tsx:219` is unchanged because the `onConfirm` contract is preserved.

- **Build 15g — Send-contract guard-rail: body must contain `{{signing_link}}`.** Surfaced during 15f smoke when Eric replaced the default email body with the literal string `TESTINGGGGGGG` for a test send (contract `6a9eaac0-1825-4297-b96d-65915c97ae38`, message_id `89306a36-e156-4d49-8a0e-01f8c61187e3`). Resend accepted the dispatch (status `sent`), Eric received the email, but it had no link to sign. Root cause: server-side `applyMergeFieldValues` (in `src/lib/contracts/merge-fields.ts:211`) is a **substitution-only** resolver — it replaces existing tokens but never **prepends** missing ones. Body lacked `{{signing_link}}` → resolver had nothing to substitute → email rendered as just `TESTINGGGGGGG`. Two-layer fix in commit `a1dfb06`:
  - **Server layer (load-bearing).** `src/app/api/contracts/send/route.ts` now rejects with HTTP 400 when the request body lacks `{{signing_link}}` — accepts either the `{{double_brace}}` token form or the Tiptap pill form `data-field-name="signing_link"`, matching what `applyMergeFieldValues` recognizes. Error copy: "Email body must contain the {{signing_link}} placeholder so the recipient gets a sign-in link."
  - **Client layer (UX fast-feedback).** `src/components/contracts/send-contract-modal.tsx` derives a `bodyHasSigningLink` boolean using the same regex/contains check, renders an inline red warning under the body editor when the user has typed something but lacks the token (`Body is missing {{signing_link}} — the recipient won't have a way to sign. Add it back before sending.`), and disables the Send button while the token is missing. Submit-time toast as a final fallback if somehow Send fires while invalid.

- **End-to-end smoke completed against prod Vercel.** Eric ran a fresh send + sign cycle on Jadon's `WTR-2026-0020` job: SendContract modal correctly disabled Send when body was blanked; restoring `{{signing_link}}` re-enabled Send; email arrived with a working link; signing page opened the new tabbed modal; both Draw + Type tabs produced PNGs that were stamped onto the contract PDF; auto-shrink + tab-switch preservation + disclaimer copy all verified.

## What's next

Priority order:

1. **Build 15e / 25b carve-out — unchanged.** Five features unported in 15d (multi-signer next-signer email handoff, customer + internal confirmation emails w/ signed PDF, reminder scheduling, regenerate-signed-PDF endpoint) + four follow-up chips (no `partially_signed` status, Test Co missing `contract_email_settings` row, Replace PDF native `confirm()` → `<ForceDeleteConfirmDialog>`, multi-signer email handoff). Resend domain verification at `resend.com/domains` is the gating pre-req for any 25b test pass that exercises real distinct-recipient email flows.

2. **Dupe-name vuln on `/api/settings/contract-templates/[id]/duplicate/route.ts:35`.** Same `Foo (Copy)` collision pattern as 15d Bug 1 — could share a `pickUniqueTemplateName(supabase, orgId, base)` helper with the create-empty fix. Carry-over from yesterday's session, untouched today.

3. **`contracts.filled_content_html` NOT NULL relaxation.** `EMPTY_HTML` + `EMPTY_HTML_SHA256` placeholder still required by the still-NOT-NULL column + the `create_contract_with_signers` RPC's `p_filled_content_html text` + `p_filled_content_hash text` parameters. Future migration could drop both, alongside `src/lib/contracts/constants.ts`. Low priority.

4. **Optional polish on the signature pad modal.** None required. If demand emerges: (a) "Change font" 3-font cycle (Caveat / Dancing Script / Sacramento) to match HelloSign exactly, (b) Upload tab for image-of-existing-sig flows, (c) Saved tab for per-signer recall (DB-schema work), (d) keyboard arrow-key tab navigation. All deliberately deferred per the design.

## Decisions locked

- **Single Caveat font, no picker.** Eric chose this over a 3-font cycle because the modal already has enough surface area; pickers add UI noise. If customers ever ask for variety, swap to a 3-font cycle is small additive work — `next/font/google` supports loading multiple faces and toggling `className`.

- **HelloSign-verbatim disclaimer copy, no checkbox.** Implicit consent on Insert click matches industry norm (HelloSign / DocuSign / PandaDoc). ESIGN Act does not require an explicit checkbox. If legal ever wants belt-and-suspenders, adding a required checkbox is small.

- **Backend zero-touch.** Both Draw and Type tabs emit identical PNG dataUrl shape (600×200 white-bg + black ink/text) through the existing `onConfirm(dataUrl: string)` callback. Server cannot distinguish typed from drawn signatures — both are PNG bytes stamped via `pdf-lib`. Considered + rejected: server-side text→PDF rendering at stamp time (would have required pdf-lib font embedding + contract-shape widening + divergent stamp paths).

- **Tab a11y via `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` / `role="tabpanel"`.** Native `<button>` semantics handle Tab + Enter; left/right arrow navigation between tabs is deliberately deferred (out of scope, low value vs. complexity).

- **Quadratic-curve smoothing over alternative (a) drop-stroke-thickness or (b) install signature_pad library.** The library would have been more capable (variable-width-by-velocity, smoother Bézier curves) but adds a dep and rewrites the hand-rolled flow. Quadratic midpoint is the cheapest acceptable fix and lives in 10 lines.

- **Guard-rail: server hard-reject + client warn-and-disable, both layers landed in one commit.** Considered: server-side auto-append of a fallback `<a href="{{signing_link}}">Open document</a>` paragraph when missing. Rejected because it's invisible to the user — the body field would lie about what gets sent. Hard-reject + visible warning forces user to fix before send, no surprises. Considered a `body.emailSubject` guard too (`{{signing_link}}` in subject is technically supported by the resolver via `extras.signing_link` injection); rejected because no real-world email puts the link in the subject and the subject is plain-text anyway.

- **Build naming 15f + 15g.** Sequential post-15d sub-build numbers; both shipped this session, both in the `Contracts` build family. 15e is reserved for the 25b orphan-route carve-out per yesterday's handoff.

## Open threads

- **Build 15e / 25b carry-over chips unchanged** — see `[[2026-05-07-build-15d-cleanup-shipped]]` and `[[2026-05-06-build-15d-test-pass-complete]]`. Five unported features + four 25b/follow-up findings.

- **Storage `contract-pdfs` orphan blobs from 15d cleanup** — ~595 KB across 5 files; Supabase storage GC will eventually clear them. Documented in yesterday's handoff. No action needed.

- **Dupe-name vuln on `/api/settings/contract-templates/[id]/duplicate/route.ts:35`** — same pattern as 15d Bug 1, untouched today, low blast radius.

- **Resend domain verification at `resend.com/domains`** — pre-req for any 25b test pass that exercises distinct-recipient email flows once 25b ports the multi-signer email handoff.

- **The contract row `6a9eaac0-1825-4297-b96d-65915c97ae38`** that triggered the guard-rail bug is still in AAA prod, status `sent` (no link in email so it's effectively orphan from the recipient's POV, but Jadon completed signing today via the manual-paste signing URL Claude pulled from `link_token`). Optionally could be voided + re-sent if Eric wants a clean record, but the existing flow worked end-to-end so leaving as-is is fine. Also: Eric's separate end-to-end smoke later in the session (after the guard-rail shipped) sent a fresh contract through the new modal flow successfully; that contract's row is in DB and not voided either.

## Mechanical state

- **Branch:** main
- **Commit at session end:** `a1dfb06` (`fix(15g): guard contract send body must contain signing_link token`)
- **Pushed:** yes. Two pushes this session: `2f1953b..9852ee4 main -> main` (15f modal + spec + plan as a 4-commit fast-forward including `669996d` spec, `fdfdcd0` plan, `9852ee4` feat) and then `9852ee4..a1dfb06 main -> main` (15g guard-rail). Both Vercel auto-deploys completed successfully and were end-to-end smoke-verified in prod.
- **Uncommitted changes:** none. Working tree clean except gitignored `out/`.
- **Migrations applied this session:** none. Both builds were code-only (TypeScript / TSX). No Supabase MCP `apply_migration` calls.
- **Deployed to Vercel:** yes, twice (auto-deploy on each push). The handoff commit on top of `a1dfb06` will trigger one more docs-only deploy.

## Notes for next session

- **Tiptap Link extension validates URLs by default and may strip non-URL hrefs.** Worth knowing for future template-editing UI work: `<a href="{{signing_link}}">` may be parsed-then-stripped by Tiptap's Link extension because `{{signing_link}}` doesn't pass the default `validate` regex. The way the SendContractModal works today, the parent's `emailBody` state is a raw string (set from `data.signing_request_body_template` on fetch); Tiptap renders this string and only round-trips through `editor.getHTML()` on `onUpdate`, which fires only on real edits. So if the user clicks Send without editing, the raw `{{signing_link}}` token survives; if they edit, the round-trip may strip the href and the token disappears. **Today's bug was simpler — Eric replaced the entire body with `TESTINGGGGGGG`** — so the Tiptap-strip pathway wasn't actually exercised. But it's a latent risk: if a user edits the body without removing the link explicitly, they may still ship a token-less body. The new server + client guards catch this case correctly (the post-Tiptap-stripped body lacks `{{signing_link}}` → guard fires). For an even-stronger fix, consider configuring Tiptap's Link extension with a permissive `validate` (or disabling URL validation specifically inside the SendContractModal's email-body editor) so `{{signing_link}}` survives the round-trip. Not urgent, today's guards cover the symptom.

- **`applyMergeFieldValues` is substitution-only, never prepends.** Worth keeping in mind for any future template work — if a callable expects a "fallback signing-link block when missing," that needs to live upstream of the resolver, not inside it. The resolver is honest about what it does (`replace` not `inject`); the right place for fallback logic is the route or the modal.

- **The Caveat font is now permanently in the prod CSS bundle.** `next/font/google` adds the font files to `.next/static/media/`. ~30KB extra payload (woff2 subset). Not a measurable cost; flagged for completeness.

- **Smoke against prod Vercel is the test pass for any UI work that needs DB.** Local dev is blocked on this Mac because no `.env.local` is present (only `.env.scratch.local` for the build-65b scratch project). Pattern that worked today: commit + push, wait for Vercel auto-deploy (~60-90s), smoke against `aaaplatform.vercel.app` directly. If we ever want local dev, prod Supabase URL + anon key need to land in `.env.local` (URL: `https://rzzprgidqbnqcdupmpfe.supabase.co`; anon key at `supabase.com/dashboard/project/rzzprgidqbnqcdupmpfe/settings/api`).

- **The signing URL recovery technique works.** When a contract goes out with a broken email but the row is in DB with a valid `link_token`, the Supabase MCP `execute_sql` query `SELECT link_token FROM contracts WHERE id = '<id>'` returns the JWT, and constructing `https://aaaplatform.vercel.app/sign/<token>` gives a working fallback URL. Useful when an email goes wrong but the contract is otherwise fine — manual paste + sign without re-sending.

- **Build numbering convention.** I named the modal upgrade 15f and the guard-rail 15g ad-hoc. Yesterday's handoff already reserved 15e for the 25b orphan-route carve-out. So today's numbers fit cleanly. If Eric prefers a different convention (e.g. 15.f, 15-followup, etc.) for future small post-ship sub-builds, easy to adjust at next session start.

## Links

- Build 15f spec: `docs/superpowers/specs/2026-05-07-signature-pad-type-mode-design.md` (commit `669996d`)
- Build 15f plan: `docs/superpowers/plans/2026-05-07-signature-pad-type-mode.md` (commit `fdfdcd0`)
- Build 15f feat commit: `9852ee4`
- Build 15g feat commit: `a1dfb06`
- Prior session: `[[2026-05-07-build-15d-cleanup-shipped]]`
- Build 15d implementation: `[[2026-05-06-build-15d-implementation]]`
- Current state: `[[00-NOW]]`
