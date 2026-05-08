---
date: 2026-05-06
build_id: 15d
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-15d]]", "[[2026-05-06-build-15d-implementation]]"]
---

# Build 15d Handoff — 2026-05-06 (Test-Pass Kickoff + Bug 1 Fix)

## What shipped this session

Two commits on top of the implementation handoff (`4208e54`):

- `96eebeb` **fix(15d): de-dupe Untitled Template name on create.** §11 Test 1 ("click Upload Contract PDF") returned 500 + redacted `{ error: "internal error" }`. Postgres logs (via Supabase MCP `get_logs`) showed `duplicate key value violates unique constraint "contract_templates_org_name_key"` 6× in a 5-minute window. Root cause: `POST /api/settings/contract-templates` insert hard-coded `name: "Untitled Template"`, hitting the unique `(organization_id, name)` index from build46 whenever an `Untitled Template` row already existed for the org. Fix: route now `SELECT`s existing names matching the requested base, derives a non-colliding candidate by appending `" (2)"`, `" (3)"`, … up to 999 before insert. Race against concurrent inserts is academic for a single-admin click flow; the unique index is the safety net.
- `a8e20ae` **docs(15d): scaffold §11 test-results doc + log Bug 1.** New file `docs/superpowers/specs/2026-05-06-build-15d-test-results.md` — 12-row summary table (all `⏸/⏭`), per-test detail sections, Bug 1 write-up with postgres-log evidence + fix commit pin, related-vulnerability note for `/api/settings/contract-templates/[id]/duplicate/route.ts:35` (`${source.name} (Copy)` has the same dupe vulnerability — not blocking, separate fix).

`96eebeb` pushed to `origin/main` (Vercel auto-deploy triggered ~17:30 PT). `a8e20ae` is local-only at session end — push at start of next session after the docs commit lands cleanly.

## What's next

- **Install the correct Chrome MCP extension + restart CC.** This session installed the wrong one — "Claude for Chrome" sidebar agent (a standalone Claude.ai browser agent) — instead of "Claude in Chrome" (extension ID `fcoeoabgfenejglbffodgkkbkcdhcgfn`, the MCP one Claude Code pairs with via `--chrome` flag or `/chrome` toggle). Confirmed correct extension is now installed at session end. **Tools didn't surface in this session** because `mcp__claude-in-chrome__*` registers at CC launch time, not on extension install — fresh session required.
- **Resume §11 Test 1.** Click "Upload Contract PDF" on the deployed Vercel build of `96eebeb`. Verify it lands in the editor instead of toasting "Failed to create template." If yes, mark Test 1 ✅ and proceed through Tests 2–12. If no, the redacted 500 will need another `get_logs` round.
- **Walk Tests 2–12 with the chrome MCP driving the browser.** Per spec §7. Capture each result into `docs/superpowers/specs/2026-05-06-build-15d-test-results.md` — flip `⏭` to `✅` / `❌` / `⏸` and fill the "Result:" line under each test.
- **Task 29 — DB + Storage cleanup of test artifacts** after Tests 2–12 produce them. SQL block ready in plan; deletes `contract_events` → `contract_signers` → `contracts` → `contract_templates` for Test Co rows created since 2026-05-06; then Storage entries under `contract-pdfs/{test-co-org-id}/templates/` and `contract-pdfs/{test-co-org-id}/contracts/`.
- **Task 25b orphan-route port (likely 15e).** Unchanged from prior handoff.

## Decisions locked

- **Chrome MCP, not standalone sidebar, for the §11 test pass.** Eric chose the Chrome MCP path so I drive the browser via DOM-aware tools (faster than computer-use, uses Eric's existing auth/cookies). The standalone "Claude for Chrome" sidebar agent is a separate product and isn't what CC pairs with.
- **Push the bug-1 fix immediately + run §11 against the live deploy** rather than batching with other 15d work or running locally.

## Open threads

All open threads from [[2026-05-06-build-15d-implementation]] carry forward unchanged. New entries:

- **`/api/settings/contract-templates/[id]/duplicate/route.ts:35` has the same dupe vulnerability as the create-empty fix** — `name: \`${source.name} (Copy)\`` will 500 on the second duplicate of the same source (`Foo (Copy)` already exists). Not blocking 15d; worth a follow-up sharing the same name-suffix derivation logic. Could also add a shared `pickUniqueTemplateName(supabase, orgId, base)` helper called by both routes.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `a8e20ae` (docs(15d): scaffold §11 test-results doc + log Bug 1). The implementation handoff (`4208e54`) and the bug fix (`96eebeb`) sit between this and the prior session's anchor (`e3790d7`).
- **Pushed:** `96eebeb` is on `origin/main` (Vercel deploy auto-triggered ~17:30 PT). `a8e20ae` is **1 commit ahead of `origin/main`** at session end — push at start of next session along with the new handoff commit.
- **Uncommitted changes:** 2 untracked, both pre-existing (`docs/superpowers/specs/2026-05-06-build-15d-preflight-capture.md` left from planning; `out/` Capacitor offline-stub directory left from 65a TestFlight build 3 — both gitignored or doc-only).
- **Migrations applied this session:** none.
- **Vercel deploy state:** auto-triggered for `96eebeb` at session end; assume green by next session start. If §11 Test 1 still 500s, recheck `mcp__claude_ai_Supabase__get_logs` for the actual postgres error.

## Notes for next session

- **The `apiDbError` redactor in `src/lib/api-errors.ts` returns `{ error: "internal error" }` to the client and only `console.error`s the real Postgres message — that message goes to Vercel function logs.** When debugging redacted 500s, `mcp__claude_ai_Supabase__get_logs` (service: `postgres`) was the fastest path: surfaced `duplicate key value violates unique constraint "contract_templates_org_name_key"` directly without needing Vercel dashboard access. **Pattern:** for any post-deploy 500 with a redacted body, pull postgres logs first; the Postgres ERROR severity entries are the raw error before redaction. (Vercel function logs would also work but require dashboard access; Supabase MCP is local to the controller.)

- **Two extensions named almost identically — "Claude in Chrome" vs "Claude for Chrome" — and they're different products.** The MCP one is `fcoeoabgfenejglbffodgkkbkcdhcgfn` and pairs with Claude Code via `--chrome` flag or `/chrome` toggle to expose `mcp__claude-in-chrome__*` tools. The sidebar one is a standalone Claude.ai browser agent that runs in the browser sidebar (Sonnet 4.6 model, "Ask before acting" mode) and doesn't surface MCP tools to CC. **Pattern:** when verifying a Chrome extension install for CC integration, check `chrome://extensions` for the exact ID, not just the display name. The two share branding closely enough that it's a real trap.

- **The `contract_templates_org_name_key` unique index from build46 applies to every default-named insert path in the contract-templates surface.** Today's fix handled the create-empty case. The duplicate route (`[id]/duplicate/route.ts:35`) has the same vulnerability with `${source.name} (Copy)`. If 15d's §11 §7 Test 11 ("Replace PDF") or any future test exercises duplicate-of-duplicate, that route will also 500. Worth either fixing it now (same suffix-derivation logic) or factoring out a shared `pickUniqueTemplateName(supabase, orgId, base)` helper before doing more dupe work.

## Links

- Build card: [[build-15d]]
- Current state: [[00-NOW]]
- Test-results doc (in-progress): `docs/superpowers/specs/2026-05-06-build-15d-test-results.md`
- Spec: `docs/superpowers/specs/2026-05-06-build-15d-contract-template-pdf-overlay-design.md` (`e9c66e9`) — §7 has the 12-test list verbatim.
- Plan: `docs/superpowers/plans/2026-05-06-build-15d-contract-template-pdf-overlay.md` (`d030c5a`)
- Prior session: [[2026-05-06-build-15d-implementation]]
- Same-day prior sessions: [[2026-05-06-build-65a-testflight-build3]], [[2026-05-06-build-67d-followup]]
