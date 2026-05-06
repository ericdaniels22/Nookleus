---
date: 2026-05-06
build_id: 15d
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[2026-05-06-build-15d-planning]]"]
---

# Build 15d Handoff — 2026-05-06 (Implementation)

## What shipped this session

30 commits (`f04ef1c` → `e3790d7`) executing 27 of the 30 plan tasks plus carve-out fixes flagged by post-task reviews. Subagent-driven workflow throughout — fresh implementer per task with spec-compliance + code-quality reviewer pair after each.

**Phase 0 — pre-flight + deps + worker** (Tasks 1–3): `f04ef1c` `react-pdf@^10` + `pdf-lib@^1.17`; `59f3114` postinstall hook copies `pdf.worker.min.mjs` to `public/`.

**Phase 1 — schema + Storage** (Tasks 4–5): migration `build15d_contract_pdf_overlays` applied to prod (`6cbf63a`) — drops `contract_templates.{content, content_html, default_signer_count}`, adds `pdf_storage_path/pdf_page_count/pdf_pages/overlay_fields/signer_count/signer_role_label`. `Contract.customer_inputs JSONB` added. New private bucket `contract-pdfs` with 4 RLS policies.

**Phase 2 — types + lib helpers** (Tasks 6–9): `7bd000d` types incl. `OverlayField` discriminated union (6 field types); `b3dc2c1` `resolve-merge-values.ts`; `16ac267` `stamp-pdf.ts` (pdf-lib server-side stamping; PDF-points top-left → bottom-left translation; multi-line label split, single-line input/merge clip); `b5a4fbe` zod overlay-fields validator.

**Phase 3 — template API** (Tasks 10–13): `df49f90` POST create-empty; `026a88e` POST/GET PDF upload + signed-url (10MB cap, parse-fail surfaced as `pdf_parse_failed`); `259150d` PATCH save + duplicate; `4a644ce` GET preview (sample stamped PDF).

**Phase 4 — editor UI** (Tasks 14–20): `0e90c0f` `<TemplatePdfUploadZone>`; `eb7554c` `<PdfCanvas>` (react-pdf rendering; per-page drop layer; CSS↔PDF coord conversion via `getBoundingClientRect`); `fb4a751` `<OverlayFieldChip>` (drag-to-move + 4-corner resize); `d1ae3e6` `<FieldPalette>` + `<FieldInspector>`; `9e2ccd4` `<TemplatePdfEditor>` orchestrator (1s debounced auto-save, 409 stale-check via `version`, dirtyRef pattern); `e4cfb95` route swap; `585425b` templates list page-count + signer-count badges; "New Template" CTA renamed "Upload Contract PDF."

**Phase 5 — signing flow rewrite** (Tasks 21–24 + post-review fixes): `9791461` `<ContractSignerView>` + extracted `<SignaturePadModal>` (canvas pointer-events; outputs `data:image/png;base64,...`); `c198c93` `/api/sign/[token]` GET returns `PublicSigningView`, POST validates inputs + uploads signature PNG + on-all-signed downloads source PDF + all signature blobs + calls `stampPdf` + uploads `{org_id}/contracts/{contract_id}-signed.pdf` + flips status to `signed`; `a685583` `/api/contracts/in-person` admin POST mirrors the stamping pipeline; `dcfa061` signing pages wired through `<ContractSignerView>` + new `InPersonSigningWrapper` for `useRouter`. **Post-review fix `8cbaab5` addressed two critical bugs caught by code-quality review:** (1) multi-signer in-person flow was unconditionally redirecting to `/complete` after signer 1 — now `<ContractSignerView>.onSigned` accepts `{ all_signed }` and the wrapper branches (push to `/complete` if true, `router.refresh()` if false). (2) misapplied `"use server"` directive on a Page module (per Next.js docs that's a Server Actions declaration, not a Server Component marker) — removed. Same commit refactored: extracted `src/lib/contracts/build-public-signing-view.ts` shared helper called by both `/api/sign/[token]` and `sign-in-person/page.tsx`, eliminating server-side `fetch` to own origin (which had been silently dropping the view-dedup `Set-Cookie` from the route handler) + duplicated view-shape construction. Added `<SignedRedirectWrapper>` so the email-link path `router.refresh()`-es after sign and renders `<SignedShell>`.

**Phase 6 — cleanup** (Tasks 25–27 + carve-outs):
- `c1ba6e7` retired the 3 Tiptap component files (`template-editor.tsx`, `merge-field-node.ts`, `merge-field-sidebar.tsx`). **Original Task 25 was BLOCKED on a design question Eric resolved as option (c)**: the orphan API routes (`/api/contracts/[id]/sign/route.ts` 475 lines, `/api/contracts/[id]/regenerate-pdf/route.ts`) still import `pdf.ts` AND contain unported production features (multi-signer email handoff, customer/internal confirmation emails with attached signed PDF, reminder scheduling, regenerate-PDF). Carved into new Task 25b — likely a standalone follow-up build (15e).
- `5596e29` react-pdf v10 CSS path fix (v10 dropped the `/esm` segment from `dist/Page/*.css`) — unblocked `npm run build`.
- `3ed4da5` Task 26: `preview-contract-modal.tsx` rewritten as iframe wrapper of the GET preview endpoint; `send-contract-modal.tsx` + `sign-in-person-modal.tsx` simplified to drop legacy preview-fetch dance. `contracts-section.tsx` and `/api/contracts/[id]/pdf/route.ts` already wired in earlier tasks (no change). `src/app/contracts/[id]/page.tsx` doesn't exist in this repo — admin contract detail surface is the per-job `<EstimatesInvoicesSection>` panel.
- `8e08060` permission-gate fix: preview endpoint was gated on `manage_contract_templates` but called from non-admin send modals — now falls back to "authenticated org member" if the manage permission check fails (sample-only data; matches the bar the send routes already use).
- `56bba7f` Task 27 — **caught two production-blocking bugs the plan never addressed**: `/api/contracts/send/route.ts` and `/api/contracts/in-person/start/route.ts` were still doing `select("content_html") + resolveMergeFields(html, jobData) + insert filled_content_html=resolved` and would have crashed at runtime on the post-15d schema. Both rewritten to drop merge pre-resolution (defer to sign time inside `stampPdf`) and validate `pdf_storage_path` instead of `content_html`. Empty string + sha256-of-empty placeholder for the still-NOT-NULL `contracts.filled_content_html` column. Two orphans deleted: `/api/contracts/preview/route.ts` (legacy HTML preview, no callers since Task 26) + `src/components/contracts/preview-modal.tsx` (no importers).
- `d3b3f3b` constants hoist: `EMPTY_HTML` and `EMPTY_HTML_SHA256` to `src/lib/contracts/constants.ts` (dedupe magic-hash from both routes).

**Phase 7 — vault** (Task 30): `e3790d7` rewrote the `[[build-15d]]` 00-NOW entry from "PLANNED, NOT YET IMPLEMENTED" to "FULLY IMPLEMENTED, AWAITING §11 MANUAL TEST PASS"; updated frontmatter `last_verified`; updated active-branches lead line; added 5 new open threads (Task 28 / Task 29 / Task 25b carve-out / schema NOT-NULL relaxation / AAA template re-upload); added 3 new "Recently learned" lessons.

## What's next

- **Task 28 — §11 manual test pass against prod Supabase Test Co.** 12 tests verbatim from spec §7 (upload AAA's FM-7001 5-page PDF, place all 5 overlay fields, move/resize + reload persistence, input/checkbox add + persist, free-text label add + persist, preview opens stamped sample PDF in new tab, send to test customer, sign as customer with required-validation, stamped PDF downloads from contract detail and renders in real PDF reader, two-signer template both-signers flow, replace-PDF confirm dialog clears fields, legacy contract still readable). Capture results into `docs/superpowers/specs/2026-05-06-build-15d-test-results.md`. Eric runs this in a real browser against the Vercel deployment.
- **Task 29 — DB + Storage cleanup of test artifacts.** SQL block ready in plan; deletes `contract_events` → `contract_signers` → `contracts` → `contract_templates` for Test Co rows created since `2026-05-06`; then Storage entries under `contract-pdfs/{test-co-org-id}/templates/` and `contract-pdfs/{test-co-org-id}/contracts/`.
- **Task 25b (NEW)** — port the unported features from the orphan routes (`/api/contracts/[id]/sign/route.ts`, `/api/contracts/[id]/regenerate-pdf/route.ts`) into the new `/api/sign/[token]` + `/api/contracts/in-person` flow, then delete the orphans + `src/lib/contracts/pdf.ts`. Five features: multi-signer next-signer email handoff (signing-request email), customer confirmation email with attached signed PDF, internal confirmation email with attached signed PDF, reminder scheduling, regenerate-signed-PDF endpoint. Likely a standalone build (15e) — not blocking 15d ship since the new routes work correctly for single-signer email-link + admin in-person flows; it's the multi-signer email handoff that's the visible regression.
- **Schema follow-up (after 25b)**: relax `contracts.filled_content_html` NOT NULL constraint + the `create_contract_with_signers` RPC's `p_filled_content_html text` + `p_filled_content_hash text` params. Once 25b is done no new contract writes meaningful HTML; the placeholder workaround can go.
- **AAA's "Emergency Services" template needs re-upload post-deploy.** Migration dropped `content_html`; row identity preserved but authoring data gone. Needs Eric to re-upload the FM-7001 PDF + re-place overlay fields once the deploy lands.

## Decisions locked

- **Task 25 scope: option (c)** — partial Task 25 only (delete the 3 Tiptap components), carve out `pdf.ts` deletion + 2 orphan-route handling into a new Task 25b that ports unported production features first. Eric explicitly confirmed when surfaced ("go with (c)").

## Open threads

- **Task 28 §11 manual test pass owed** — Eric's responsibility, against the Vercel preview/prod URL post-push.
- **Task 29 DB + Storage cleanup** — depends on Task 28 producing test artifacts.
- **Task 25b orphan-route port** — likely a standalone follow-up build (15e). Touching it requires re-implementing email-handoff + confirmation-emails + reminder-scheduling + regenerate-PDF against `stampPdf` + `resolveMergeValues` instead of the legacy `generateSignedPdf`. Email/reminder logic in those orphans is non-trivial — fold in deliberately.
- **Schema follow-up NOT-NULL relaxation** — wait until 25b is done.
- **AAA "Emergency Services" template re-upload** — Eric does this once deploy lands.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `e3790d7` (vault: 15d implementation state — 27/30 tasks done, awaiting §11 manual test pass)
- **Uncommitted changes:** 2 untracked, both pre-existing (`docs/superpowers/specs/2026-05-06-build-15d-preflight-capture.md` left from planning session; `out/` Capacitor offline-stub directory left from 65a TestFlight build 3 session — both gitignored or doc-only, not 15d artifacts)
- **Migrations applied this session:** `build15d_contract_pdf_overlays` (applied via Supabase MCP in the prior partial session — confirmed live; this resume session did not touch migrations)
- **Deployed to Vercel:** pending — push happens after this handoff, will trigger auto-deploy to `aaaplatform.vercel.app` for §11 testing

## Notes for next session

**Subagent-driven development was material to quality.** Two critical Task 24 bugs only surfaced because the code-quality reviewer ran independently of the implementer's self-review:
1. The implementer's wrapper unconditionally redirected to `/complete` after signer 1 — would have silently broken every multi-signer in-person flow on first prod use.
2. `"use server"` at the top of a Page module is a misapplied Next.js directive. The implementer self-reviewed clean. The code-quality reviewer caught it by reading the Next.js docs.

**Task 27's tsc + grep sweep was load-bearing.** It surfaced two routes (`send/route.ts`, `in-person/start/route.ts`) that the plan never enumerated in any task and that would have crashed on first POST against the post-15d schema. Lesson: when a build retires a column type-system-wide, run `grep` for the column name as a sanity check even after tsc is clean — `select(...)` payload columns aren't always reflected in TS types depending on how the Supabase client is typed.

**react-pdf v10 dropped the `/esm` segment from CSS imports.** Old paths `react-pdf/dist/esm/Page/AnnotationLayer.css` are gone in v10; new paths are `react-pdf/dist/Page/AnnotationLayer.css`. Plan snippets and external docs may carry the stale path. Pattern: when a UI lib's "build broken" error mentions specific dist paths, verify against `node_modules/<pkg>/package.json` `exports` field before debugging the bundler.

**Server-side `fetch` to own origin is the wrong pattern.** Task 24's first-pass implementation reconstructed `${proto}://${host}/api/sign/${token}` from request headers and `fetch()`-ed it from the page Server Component. Two problems: (a) `Set-Cookie` from the API response never reaches the user's browser → audit log gets a duplicate `link_viewed` row on every page reload; (b) ~35 lines of view-shape construction get duplicated between the route handler and the page. Fix is to extract a shared data-loading helper and import it from both.

**The orphan routes contain real production logic.** When you do Task 25b, study `/api/contracts/[id]/sign/route.ts` lines 932–939 and 982–1001 of the deleted `tablet-signing-form.tsx` for the multi-signer in-place reset pattern that the new flow lost. Don't treat the orphans as dead code to delete — they're a feature checklist to port.

**Auto mode + subagent-driven development worked well together.** ~12 subagent dispatches, only one required Eric's intervention (Task 25 option-c choice). Reviewer pairs caught real bugs at every stage. Spec reviewer's "do not trust the implementer's report" framing is doing real work.

## Links

- Build card: [[build-15d]]
- Current state: [[00-NOW]]
- Planning session: [[2026-05-06-build-15d-planning]]
- Spec: `docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md` (`e9c66e9`)
- Plan: `docs/superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md` (`d030c5a`)
- Same-day prior sessions: [[2026-05-06-build-65a-testflight-build3]], [[2026-05-06-build-67d-followup]]
