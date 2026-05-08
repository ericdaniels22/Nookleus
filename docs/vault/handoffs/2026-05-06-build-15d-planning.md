---
date: 2026-05-06
build_id: 15d-planning
session_type: planning
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[build-15a]]", "[[build-15b]]", "[[build-15c]]", "[[2026-05-06-build-65a-testflight-build3]]"]
---

# Build 15d Planning Handoff — 2026-05-06

Planning session — spec + implementation plan committed. **No code written.** The build itself happens in a fresh session.

## What shipped this session

- **Spec for Build 15d — Contract Template PDF Overlay Builder** at `docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md` (commit `e9c66e9`). Replaces the existing Tiptap-based contract template editor with a PDF-upload + drag-overlay-fields builder. Authors upload a finished PDF (e.g. AAA's existing FM-7001 work-authorization contract), drop six kinds of overlay fields onto exact coordinates per page (merge field, signature, date, free-text label, customer-fillable input, checkbox), and at sign-time the customer fills any inputs/checkboxes and signs in-browser; the server stamps all values onto a copy of the PDF using `pdf-lib` and stores the stamped PDF as the signed contract artifact. **The Tiptap editor and the existing 685-line HTML→PDF renderer at `src/lib/contracts/pdf.ts` are retired in this same build** — there is no coexistence period. PDF-upload is the only authoring path going forward.

- **Implementation plan for Build 15d** at `docs/superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md` (commit `d030c5a`). 30 tasks across 7 phases: pre-flight + deps install (Tasks 1-3), schema migration + Storage bucket (Tasks 4-5), core types + lib helpers + `stamp-pdf.ts` (Tasks 6-9), template authoring API routes (Tasks 10-13), editor UI — palette + canvas + chip + inspector + orchestrator + page wiring (Tasks 14-20), signing flow rewrite — `<ContractSignerView>` + `<SignaturePadModal>` + `/api/sign/[token]` GET+POST + in-person mirror + page swaps (Tasks 21-24), cleanup + retire legacy (Tasks 25-27), §11 12-test pass + cleanup + vault state (Tasks 28-30). Plan includes complete code (not pseudocode) for every component, with exact file paths, exact `npm install` + `cp` + Supabase MCP commands, and explicit type-check/build verification steps after each phase. Self-review at bottom cross-checks every spec section against task coverage; no placeholders.

- **Two spec corrections discovered during plan-write and rolled into the plan:**
  1. Spec §3.1 named the new column `signed_pdf_storage_path`. The existing schema already has `Contract.signed_pdf_path` (per `src/lib/contracts/types.ts:77`). Plan **reuses the existing column** rather than adding a redundant new one.
  2. Spec §3.2 used `signerIndex: 0 | 1` for signature-field references. The existing schema has a `contract_signers` table (one row per signer with `signer_order: 1 | 2`, `signature_image_path`, `signed_at`, etc. per `types.ts:94-110`). Plan uses **`signerOrder: 1 | 2` matching `contract_signers.signer_order`**, and the stamping function takes signature data-URLs keyed by `contract_signers.id` (uuid string).

- **Brainstorm process followed end-to-end via `superpowers:brainstorming` → `superpowers:writing-plans`.** Four locked decisions in the spec's §2 table came from the dialogue: (1) overlay-only, no underlying-PDF-text editing — the PDF is the visual document and only fields are positioned overlays; (2) Tiptap retired, PDF-only authoring (Eric's call: "no reason to write a custom contract from the editor"); (3) six field types — merge / signature / date / label / input / checkbox; (4) single coherent build, no phased feature flag.

## What's next

- **Push commits to origin/main.** Two commits ahead at session end (`e9c66e9` spec + `d030c5a` plan + the handoff commit on top of those). The wrap-step push is the last thing this session does. **No PR/merge — main is the working branch per repo convention; commits go straight to main.**

- **Fresh session picks up the plan and executes it.** Recommended: `superpowers:subagent-driven-development` (one subagent per task with two-stage review between tasks) given the build's blast radius — schema migration, PDF stamping correctness, signing-flow rewrite. Inline execution via `superpowers:executing-plans` is also viable for someone who prefers checkpointed batches. Eric's choice when he kicks off the build session.

- **Plan presupposes prod state confirmation in Task 1.** Before applying the migration in Task 4, the executing session must verify:
  - `contract_templates` columns are still `content` (jsonb), `content_html` (text), `default_signer_count` (int) — i.e. no partial 15d migration state from a stalled run
  - No in-flight unsigned contracts with live signing links pointing at HTML templates (those would orphan when the renderer is deleted in Task 25)
  - `contract_signers.signature_image_path` storage layout (used by the new `contract-pdfs` bucket layout for consistency)

- **Eric will need to re-upload AAA's "Emergency Services" contract PDF after deploy.** The migration drops `content_html` so the existing template loses its authoring data; the row identity is preserved (id, name, etc.) so any consumers won't break, but the template is unusable until Eric drops the FM-7001 PDF onto the new editor and places overlays. Plan §11 manual test pass walks through this flow on Test Co before Eric does the prod equivalent.

- **Other open carry-overs from prior sessions unchanged** — see [[2026-05-06-build-65a-testflight-build3]] for the 65a/65b/67c2/67d/QB-token list. None affected by this planning session.

## Decisions locked

- **PDF-upload-and-overlay is the ONLY contract template authoring path going forward.** Tiptap retired in same build. No coexistence period, no migration of existing Tiptap content to PDF. Existing `contract_templates` rows lose authoring data on migration; row identity is preserved; Eric re-uploads PDFs post-deploy. Rationale per Eric: "no reason to write a custom contract from the editor."

- **Six field types, locked:** merge, signature, date, label (free-text added by author at design-time), input (customer fills at sign-time), checkbox (customer ticks at sign-time). All six are needed because Eric explicitly listed all three of free-text, customer-fillable, and checkbox as "options" beyond the obvious merge/signature/date.

- **Single coherent build, not phased.** Editor + signing flow + stamping + Tiptap retirement all ship in one PR. Phased feature-flag approach explicitly rejected because phase 1 (editor only) has no user-visible value without phase 2 (signing flow rewrite); the two are too tightly coupled to benefit from a split.

- **`pdf-lib` for sign-time stamping; `react-pdf` (which wraps `pdfjs-dist`) for in-browser rendering in both editor and customer view.** Distinct from build 67c1's `@react-pdf/renderer` stack — that one builds PDFs from React components; `pdf-lib` modifies existing PDF bytes. Both libs ship together post-67c1 / post-15d.

- **Drag-from-palette UX, not click-to-place.** Sidebar pills → drag onto PDF page → drop at cursor coords → drag-to-move + corner-handles to resize after placement. Industry-standard DocuSign/PandaDoc pattern.

- **Coordinate system: PDF points (1pt = 1/72"), top-left origin in editor + storage.** Stamping function (`src/lib/contracts/stamp-pdf.ts`) translates to bottom-left origin for `pdf-lib` at draw time. Stored coordinates are stable across page re-renders / scale changes / display zoom.

- **New private bucket `contract-pdfs`.** Source template PDFs at `{org_id}/templates/{template_id}.pdf`; stamped signed contracts at `{org_id}/contracts/{contract_id}-signed.pdf`. RLS: 4 policies — read for org members, insert/update/delete for org members with `manage_contract_templates` on the `templates/` prefix only. The `contracts/` prefix is service-role-only (server stamps via service-role key during signing flow).

- **Auto-save with 1s debounce + manual Save button.** Reuses 67a 409-stale-check pattern via `version` column. On 409 the editor refetches and toasts "Reloaded latest version" — no auto-merge.

- **Existing `Contract.signed_pdf_path` reused** for the stamped final PDF (column predates 15d; previous HTML-render path also used it). New build adds `Contract.customer_inputs JSONB` only. Existing `Contract.filled_content_html` retained for legacy already-signed-as-HTML contracts; never written for new PDF-based contracts.

## Open threads

- **`contracts.status` enum doesn't include `partially_signed`.** Plan Task 22 surfaced this: when signer 1 of 2 signs, the spec's §4.2 walkthrough sets status to `partially_signed`, but `ContractStatus` (types.ts:46-52) only lists `draft | sent | viewed | signed | voided | expired`. Plan picks (a) — keep status at `viewed` until both sign — for v1 simplicity. Carry-over: if Eric wants explicit partial-signed display, follow-up migration adds the enum value + status-pill mapping. Non-blocking.

- **pdfjs worker path on Vercel build.** Plan Task 3 copies `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs` via a `postinstall` hook. The worker filename varies by `pdfjs-dist` major version (4.x = `.mjs`, 3.x = `.js`). Plan handles both cases via `ls node_modules/pdfjs-dist/build/` verification, but **the executing session should verify the actual file shipped by react-pdf 10.x's pinned pdfjs-dist** before running the postinstall — if the path is wrong, every page render in editor + signing view will fail silently with a "worker failed to load" console error.

- **`PublicSigningView` shape change is breaking for any third-party consumer of `/api/sign/[token]`.** No such consumers known to exist (the route is only called by AAA's own customer-signing page), but worth a grep at execution time. Plan Task 22's GET handler returns the new shape unconditionally — no version negotiation.

- **Legacy HTML signed contracts.** Read path forks: `signed_pdf_path` if present (new + retroactive — both old HTML and new PDF use this column); else `legacy_html` falls back to `filled_content_html`. Plan §11 Test 12 verifies a pre-15d HTML contract still renders. **If any pre-15d contracts have `signed_pdf_path = NULL` and `filled_content_html = NULL`** (truly empty rows) the read path returns "No PDF available" — worth a one-time SQL audit at execute-time.

- **Sample data resolution in `/api/settings/contract-templates/[id]/preview`.** Plan Task 13 hardcodes a fake set of merge values ("John Doe", "123 Main Street", etc.) that aren't dynamically derived from the merge-field registry. If `MERGE_FIELDS` adds a new field name post-15d, the preview won't surface a sample value for it (renders empty). Acceptable for v1; tighter coupling can be a follow-up where the registry self-supplies sample values per field.

- **`contract_templates.is_active` semantics.** Existing field, kept unchanged. Plan Task 10 sets `is_active: false` on creation — Eric flips it active after he's verified the template renders correctly via Preview. List page rendering of inactive templates is unchanged from current behavior.

- **AAA's existing "Emergency Services" template will need to be re-uploaded post-deploy.** The migration in Task 4 drops `content` + `content_html` columns; the row identity (id, name="Emergency Services", description, signer_role_label) is preserved but `pdf_storage_path` is NULL until Eric uploads the FM-7001 PDF + drops 5 overlay fields (page 4 county merge, page 5 NAME merge + SERVICE LOCATION merge + CUSTOMER SIGNATURE signature + DATE date). Walk-through is exactly the §11 Test 1-3 sequence; just done against AAA prod org instead of Test Co.

## Mechanical state

- **Branch:** main
- **Commit at session end:** `d030c5a` (`plan(15d): contract template PDF overlay implementation plan`) — to be followed by this handoff commit
- **Ahead of origin/main:** 2 commits at handoff-write time (`e9c66e9` spec, `d030c5a` plan); will be 3 after this handoff commits; all pushed at session wrap
- **Uncommitted changes:** none in tracked files; 1 untracked dir (`out/` — gitignored, regenerated on next cap sync)
- **Migrations applied this session:** none — Build 15d migration is documented in plan Task 4 but **not yet applied**. Migration application happens in the execute session, not in the plan-write session.
- **Storage bucket changes:** none — `contract-pdfs` bucket creation is plan Task 5, not yet executed
- **Code changes:** none — plan-write session only. The two committed files are documentation; zero `.ts`/`.tsx` files modified.
- **Vercel deploys:** none triggered (no code changes; vault + spec/plan changes don't trigger build redeploy beyond a Vercel build that no-ops on docs-only diffs)
- **TestFlight changes:** none

## Notes for next session

- **The plan is the source of truth for execution.** The spec describes intent + decisions; the plan describes mechanics + sequence + exact code. If the plan and spec diverge, the plan wins — it's the file that was most-recently corrected against actual codebase state (the `signed_pdf_path` and `signerOrder` corrections at the top of the plan are documented examples).

- **Subagent-driven execution is recommended over inline.** Build size is 30 tasks across 7 phases — comparable to 67d (27) and 67b (52). The signing-flow rewrite (Tasks 22-24) and the Tiptap retirement (Task 25) both have real blast radius; fresh-subagent-per-task with two-stage review provides better failure isolation than batched inline execution. The `superpowers:subagent-driven-development` skill handles this orchestration.

- **`npm install --save react-pdf@^10 pdf-lib@^1.17`** is plan Task 2 step 1. Both are pure-JS libs (no native bindings, no Vercel edge-runtime issues). React-pdf 10.x requires React 18+; current AAA Next.js is on React 19, so peer satisfied.

- **Pre-flight (Task 1) is non-trivial.** Four `execute_sql` queries against prod via Supabase MCP capture: `contract_templates` columns, template count per org, in-flight unsigned-contract count with live signing links, `contract_signers` storage path layout. Eric should be in the loop if Step 3 reveals any active signing links — those should drain (sign or expire) before the migration runs, otherwise the link recipient sees a broken page.

- **The plan does NOT split out a unit-test phase.** This codebase has no test framework — verification is `npx tsc --noEmit` clean + `npm run build` clean + manual §11 12-test pass against prod Supabase Test Co. Plan adheres to that pattern (no jest/vitest/playwright config); the writing-plans skill's TDD format is adapted to: write code → tsc check → §11 manual at end-of-build.

- **Build 15d carries forward all 65a/65b/67c2/67d/QB-token open items unchanged** from the 65a TestFlight Build 3 handoff ([[2026-05-06-build-65a-testflight-build3]]). This session did not touch any of those — pure planning, scope tight to 15d.

- **No build number conflict.** 15d follows 15a (templates) → 15b (remote signing) → 15c (in-person + multi-signer + reminders). The 67-series (67a-d) is estimates+invoices and unrelated to contracts. `[[build-15d]]` build card may need creation — the 00-NOW entry will be the canonical landing for now.

## Links

- Spec: [`docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md`](../superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md)
- Plan: [`docs/superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md`](../superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md)
- Build card: [[build-15d]] (to be created — for now this handoff is the landing)
- Current state: [[00-NOW]]
- Same-day prior session: [[2026-05-06-build-65a-testflight-build3]]
- Predecessor builds: [[build-15a]] (templates), [[build-15b]] (remote signing), [[build-15c]] (in-person + multi-signer + reminders)
- Adjacent prior art: [[build-67c1]] PDF rendering (`@react-pdf/renderer` for estimates/invoices — distinct stack; both libs ship together post-15d)
- Source PDF used in spec/plan examples: `/Users/vanessavance/Downloads/Copy of RC Work Authorization.pdf` (FM-7001 Emergency Services Contract & Work Authorization, 5 pages)
