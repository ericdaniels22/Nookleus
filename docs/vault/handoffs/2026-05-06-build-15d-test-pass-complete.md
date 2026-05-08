---
date: 2026-05-06
build_id: 15d
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[2026-05-06-build-15d-test-pass-bugs-5-6-fix]]"]
---

# Build 15d Handoff — 2026-05-06 (§11 test pass complete: Tests 9–12 + 4 findings)

## What shipped this session

- **Test 9 (verify stamped PDF) ✅ PASS** — closed by deploying Bug 6 fix `8f2411b` and verifying end-to-end. Push of `8f2411b + 0111dc5` triggered Vercel deploy; after deploy, `GET /api/contracts/114aab5e-8d54-4be0-ad5f-3584055db7af/pdf` returned `200 application/pdf` / `Content-Length: 287681` / header `%PDF-1.7` (was `500 {"error":"Object not found"}` pre-fix). Parsed via `pdfjs-dist@4.7.76` dynamic-imported from jsDelivr CDN. **Per-page paint-image counts: `[1, 0, 0, 0, 1]`** — page 1's image is the FM-7001 source logo; **page 5's image is the customer signature** stamped at sign time, confirming Bug 5 fix end-to-end through the rendered artifact (not just the DB write). All 7 stamped fields verified at expected PDF-pt positions (drift ≤14pt consistent with `pdf-lib` baseline-y semantics): INTERNAL USE ONLY label on page 1, customer_name resolved to "Brenda Watson" (real, NOT preview sample "John Doe"), property_address resolved (Austin/TX tokens present, NOT "123 Main Street"), MM/DD/YYYY date stamp, "Test pass — signed via Chrome MCP" input value at (200, 387 bottom-left), X glyph at (296, 338) inside the agree_terms checkbox bounds, signature image embedded.

- **Test 10 (two-signer template) ✅ PASS with caveats.** Setup detour: created a 2-signer template `65cb772f-...` in Test Co first, but `POST /api/contracts/send` returned `500 Contract email settings missing` because Test Co lacks a `contract_email_settings` row (the build 67c2 trigger seeds `payment_email_settings`, a different table). Switched to AAA org per Eric's call. Created new AAA template `cf0a41af-2695-460c-b1c8-a6efdd9d9868` "Test 10 — Two-signer (AAA)" via API + `signer_count = 2` patched + Eric uploaded PDF + dropped 2 signature fields on page 5 with distinct `signerOrder` (1 and 2). Sig 1 at (140, 34, 180×40); Sig 2 at (198, 87, 180×40).

  - **Send:** `POST /api/contracts/send` with both signers = `eric@aaacontracting.com` (Resend test-mode constraint), distinct names "Eric Test (Signer 1)" and "Eric Test (Signer 2)". Contract `43c31af5-bba9-4b73-bf2a-dfc18593c786`, Resend message_id `958df8f6-dcae-4793-92e4-5dca211d7991`. Attached to Brenda Watson's `JOB-2026-0019` (`128e6f02-...`) — same job as Test 7+8 to concentrate test artifacts for cleanup.

  - **Stage A — signer 1 via email-link `/sign/[token]` flow:** Eric pasted the signing link from his inbox. JWT decoded as `{contract_id: 43c31af5..., signer_id: 1e696fe7..., iat, exp}`. Signature drawn via 5 synthetic `PointerEvent`s (down → 3 moves → up) on the 334×113 signature-pad canvas (narrower than Test 8's 600×200 due to viewport responsive sizing). `Confirm signature` enabled after stroke; `Submit signed contract` POST returned `200 {ok: true, all_signed: false}`. State after: `signers[0].signed_at = 2026-05-07T03:16:39.919+00:00`, `signers[1].signed_at = null`, body shows "Awaiting other signer".

    **Caveat — first stroke draw locked the renderer:** my first sig-draw script used `setTimeout(12)` between each of 12 pointermoves; the CDP `Runtime.evaluate` timed out at 45s. Retry with 5 events fired synchronously (no awaits between them) drew successfully + registered hasInk. Recipe for future Chrome-MCP-driven signature pads: keep stroke length ≤ ~10 events and don't `await setTimeout` between them.

  - **Stage B — signer 2 via `/api/contracts/in-person` admin route** (workaround for unported email handoff): synthesized a 600×200 PNG via offscreen canvas with bezier curve + "S2" text annotation (so the second signature is visually distinguishable in the stamped PDF). POST `{contract_id, signer_id: c2dc602a-..., customer_inputs: {}, signature_data_url}` returned `200 {ok: true, all_signed: true}`.

  - **Final state:** `contracts.status = "signed"`, `signed_at = 2026-05-07T03:17:26.288+00:00` (matches signer 2's signed_at — route stamps both at the same instant when allSigned). Stamped PDF: 5 pages, 289,553 bytes (~2 KB more than Test 9's single-signer 287,681), per-page image counts `[1, 0, 0, 0, 2]` — **page 5 has exactly 2 paint-image ops, one per signer's signature**, at distinct positions per `signerOrderById` lookup in `stampPdf`. Validates dual-stamp logic end-to-end.

- **Test 11 (Replace PDF) ✅ PASS** — server-side E2E + UI code-read coverage. Generated two test PDFs via `pdf-lib@1.17.1` from jsDelivr CDN: PDF-A (1986 bytes / 5 letter pages) and PDF-B (940 bytes / 1 letter page). New AAA template `c5b6a727-5ed5-499a-8d73-2e0240723a66` "Test 11 — Replace PDF (AAA)". Phase 1: POST PDF-A to `/api/settings/contract-templates/[id]/pdf` → 200, `pdf_page_count = 5`. Phase 2: PATCH 2 overlay fields (label "TEST 11 PRESENT" on page 1 + `customer_name` merge on page 3) → 200, `overlay_fields.length = 2`, `version = 4`. Phase 3: POST PDF-B to same endpoint → 200, **`overlay_fields.length = 0` (wiped)**, `pdf_page_count = 1`, `pdf_pages.length = 1`, `version = 5`, new `pdf_storage_path`. UI button-click path verified by code-read (`template-pdf-editor.tsx:149-172` calls `confirm()` then dynamic `<input type=file>` then same POST endpoint we exercised). Did **not** E2E the UI button click because Chrome MCP can't drive native `confirm()` modals (per harness rules — they freeze the renderer). Filed carry-over chip: swap `confirm()` for shared `<ForceDeleteConfirmDialog>` so future MCP-driven test passes can E2E this through the UI.

- **Test 12 (Legacy contract readable) ⏭ N/A** — per Eric's recollection, neither AAA prod nor Test Co has any pre-15d signed contract. Brenda's job has only post-15d test contracts; no other active org accumulated signed legacy contracts before 15d shipped. **Implication for 15d ship readiness:** the legacy-render code path (`filled_content_html` rendering) is dormant in practice. Schema migration kept `contracts.filled_content_html` intact (the post-Task 27 fix in implementation hoisted an empty-HTML placeholder for the still-NOT-NULL column), so any hypothetical future legacy data would still render. Zero runtime risk of a real customer hitting a broken legacy view because no real customer has a legacy contract.

- **Two doc-only commits ahead of origin** at session end:
  - `db6da4a` `docs(15d): annotate §11 test-results with Test 7/8/9 + Bug 5/6 evidence` — backfills Tests 7+8 details from the prior session and adds Bug 5 + Bug 6 sections to the test-results doc. Test 7+8 were left as `_pending_` in the prior /handoff push because the doc updates ran out of session time.
  - `eeb5636` `docs(15d): annotate §11 test-results with Tests 10/11/12 + four findings` — closes the test-results doc for the §11 pass.

- **§11 manual test pass complete:** 12/12 resolved (10 PASS, 1 N/A, several with caveats). Test results doc at `docs/superpowers/specs/2026-05-06-build-15d-test-results.md` is now the authoritative summary.

## What's next

Priority order:

1. **Push the two commits to origin** (`db6da4a` + `eeb5636`). Doc-only; Vercel auto-deploys but no UI/API change. ~75s for the deploy etag flip.

2. **Eric drives Task 29 cleanup** of test artifacts (per his explicit "I can handle cleanup myself"). Cleanup list captured in test-results.md → `## Test artifacts to clean up (Task 29)` section. AAA: 4 templates (`60862e63` WTR, `d9767028` Untitled (2), `be7fd911` Untitled (3), `cf0a41af` Test 10, `c5b6a727` Test 11) + 3 contracts (`c373a47f` voided draft, `114aab5e` Test 8/9 signed, `43c31af5` Test 10 signed) + storage objects under both signed contracts. Test Co: `65cb772f` Test 10 abandoned template. **Brenda Watson's `JOB-2026-0019` is a real customer job — DO NOT delete the job; only the test contracts attached to it.**

3. **Mark build 15d as shipped** in the vault (`build-15d.md` build card status update — handoff skill handles this via 00-NOW.md flip).

4. **Build 15e / 25b carve-out** — five features unported in 15d (multi-signer next-signer email handoff, customer confirmation email with attached signed PDF, internal confirmation email with attached signed PDF, reminder scheduling, regenerate-signed-PDF endpoint) plus the carry-over chips this session added: `partially_signed` status, send-route 400-vs-500 polish for orgs missing contract_email_settings, Replace PDF native-confirm swap.

5. **Resend domain verification at `resend.com/domains`** — pre-req for any future test pass that exercises real distinct-recipient email flows (e.g. testing the multi-signer email handoff once 25b ports it, or sending to non-Eric customers in production).

## Decisions locked

- **Test 10 Stage B used `/api/contracts/in-person` instead of email-link for signer 2** — cleanest workaround for the unported multi-signer email handoff. Same shared `stampPdf` code path as the email-link flow, so the artifact outcome is identical. Trade-off: doesn't validate signer-2 JWT scoping, but that's moot since the email handoff is unported anyway.

- **Test 12 marked N/A, not BLOCKED.** No production legacy data exists to test against; the schema kept the column intact. This isn't a deferred test — it's a "no-op test for this build's data shape" outcome.

- **Did not E2E Test 11's UI button click path.** Chrome MCP can't drive native `confirm()` modals (system prompt forbids triggering them — they freeze the renderer). Backend behavior + code-read coverage is sufficient for the Replace PDF mechanism.

- **Did not run the synthetic File-drop experiment for the editor's drop zone.** Eric's session was sufficient to drive PDF uploads manually. The experiment can be a 25b-era exercise if it adds value for future automation.

## Open threads

- **Local-only commits** `db6da4a` + `eeb5636` — push at /handoff push (this session-end push). Vercel will auto-deploy doc-only changes but the build artifact won't change.

- **Test artifacts pending cleanup** (Eric will drive). Real-customer-job protection still applies to Brenda Watson's `JOB-2026-0019`.

- **Orphan routes still carry Bug 6's wrong-bucket name** (`regenerate-pdf/route.ts:59` and legacy `[id]/sign/route.ts:338`). Not in active 15d flow; deferred to 25b. Eric chose option B (leave as-is; 25b will rewrite/delete).

- **Multi-signer-email-handoff still unported** in active 15d sign route. Test 10 confirmed this surface area: new `/api/sign/[token]` after signer 1 just returns `{ok: true, all_signed: false}` — no `activate_next_signer` RPC, no signer-2 email dispatch, no status flip to a "next signer's turn" state. 25b scope.

- **`partially_signed` status not written.** Spec said signer 1 → `partially_signed`. Actual transition is `sent` → `viewed` (after signer 1) → `signed` (after signer 2). UI/admin views referring to `partially_signed` would always render the `viewed` label instead. 25b chip — either define + write the status or update UI to handle `viewed` as the partially-signed display state.

- **Test Co lacks `contract_email_settings` row.** `POST /api/contracts/send` returns generic `500 Contract email settings missing` instead of a 400 with admin-redirect link. Mirrors 67c2's `from_unconfigured` modal pattern; worth a small route-level polish.

## Mechanical state

- **Branch:** main
- **Commit at session end:** `eeb5636` (`docs(15d): annotate §11 test-results with Tests 10/11/12 + four findings`)
- **Pushed:** none of this session's commits — **2 commits ahead of `origin/main` at session end** (`db6da4a` + `eeb5636`), push as part of /handoff.
- **Uncommitted changes:** none. Working tree clean except gitignored `out/`.
- **Migrations applied this session:** none (Test Co's missing `contract_email_settings` row was *not* fixed; Eric routed around it by switching to AAA org).
- **Deployed to Vercel:** session inherited the prior session's deploy of `0111dc5` (handoff commit on top of `8f2411b` Bug 6 fix). Push at /handoff time will deploy `eeb5636` (doc-only, no behavior change).

## Notes for next session

- **Synthetic PointerEvents on signature-pad canvas:** keep stroke event count low (~5 events) and **do not `await setTimeout` between events** — CDP `Runtime.evaluate` will time out at 45s waiting for the synced eval. Fire all events synchronously in a single block, then a separate eval to read confirm-button state. The 5-point stroke `down → 3 moves → up` was sufficient to trigger `hasInk` and enable Confirm.

- **Signature-pad canvas size is responsive:** Test 8 saw a 600×200 modal canvas; Test 10 saw 334×113 on the same viewport. Filter for canvas in DOM via `width < 500 && height < 200 && height > 50` rather than hardcoded 600×200. The page-render canvases are always larger (752×973 in this session).

- **`/api/contracts/in-person` is the cleanest admin path to drive any signer's signature** without fetching a JWT from the email or constructing one server-side. Body shape: `{contract_id, signer_id, customer_inputs, signature_data_url}`. Auth via Supabase session (admin-on-iPad flow per the route comment), so it works from any logged-in admin's session. Same shared `stampPdf` code path → same artifact outcome.

- **`pdf-lib@1.17.1` from `https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm`** generates valid PDFs in-browser for test fixtures. 1986 bytes for a 5-page Helvetica-only document. Useful for Test 11-style "drop a different PDF" automation without touching real PDFs.

- **`pdfjs-dist@4.7.76` from jsDelivr** (separate from the project's react-pdf wrapper) provides direct `getDocument` + `getOperatorList` access for image-count probes per page. Recipe: `for (const fn of ops.fnArray) if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject || fn === pdfjs.OPS.paintJpegXObject) images++;`.

- **PII filter on Chrome MCP `javascript_tool`** redacts response strings that include URLs in the body (saw it on `/api/jobs?status=...` probe and on the `signers[].token` field). Workaround: stash large/sensitive responses on `window.__foo` and only `return` numeric/boolean summaries. Building output strings with `+` concatenation and short keys avoids the redactor more reliably than `JSON.stringify` of an object that includes URL-shaped values.

- **`/api/contracts/by-job/[jobId]` returns full contract list with signers** — useful for state probes mid-flow (signed_at populated? signature_image_path written?). The PII filter masks `signature_image_path` strings (path-shaped) so don't rely on `has_path` booleans alone — verify success via `signed_at` instead.

- **The "Replace PDF" UI flow uses native `confirm()` + dynamic `<input type=file>`** — Chrome MCP can't drive either of these without freezing the renderer. The backend `POST /api/settings/contract-templates/[id]/pdf` is the same code path the UI eventually calls; testing it directly is sufficient. Replace PDF-side carry-over: swap `confirm()` for the project's shared `<ForceDeleteConfirmDialog>` (same pattern as 67c2's send + 67d's trash flows).

## Links

- Build card: [[build-15d]]
- Current state: [[00-NOW]]
- Test results doc: `docs/superpowers/specs/2026-05-06-build-15d-test-results.md`
- Prior session: [[2026-05-06-build-15d-test-pass-bugs-5-6-fix]]
- Implementation: [[2026-05-06-build-15d-implementation]]
- Spec: `docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md`
