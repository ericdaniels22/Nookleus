---
date: 2026-05-15
build_id: template-hard-delete
session_type: implementation
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-15-76-template-hard-delete-prd]]", "[[build-15d]]"]
---

# Build template-hard-delete Handoff — 2026-05-15 (sixteenth session, #76 contract-template permanent-delete fully implemented — PR #77 open, both migrations applied to prod)

## What shipped this session

- **Issue #76 — "Permanently delete contract templates" — implemented end to end.** One source commit `7431069` `contracts: permanently delete contract templates (#76)` on branch `claude/76-template-hard-delete`, opened as **[PR #77](https://github.com/ericdaniels22/Nookleus/pull/77)** against `main` with `Closes #76`. **PR #77 is OPEN — not yet merged.** 13 files, +1041 / −27.
- **Two migrations applied directly to AAA prod** (`rzzprgidqbnqcdupmpfe`) and verified:
  - `build76_template_id_nullable_fk` — `contracts.template_id` dropped `NOT NULL`; `contracts_template_id_fkey` recreated `ON DELETE SET NULL` (`confdeltype` now `n`).
  - `build76_hard_delete_contract_template_rpc` — new `hard_delete_contract_template(p_template_id uuid, p_org_id uuid)` Postgres function.
  - Both surfaced for plain-text "yes apply" first per `feedback_supabase_mcp_prod_migration_approval.md`. SQL also committed as `supabase/migration-build76-template-id-nullable-fk.sql` + `supabase/migration-build76-hard-delete-template-rpc.sql`.
- **Seven pieces, all in the one commit:**
  1. FK migration (above).
  2. `src/lib/contracts/template-deletion-eligibility.ts` — pure deep module, built TDD: input referencing contracts `{id,status}`, output `{deletable, blockers, draftIds}`. 10 tests.
  3. `hard_delete_contract_template` RPC — authoritative re-check gate (RAISEs `template_delete_blocked` token on a `sent`/`viewed` race; deletes `draft` contracts; deletes the template; FK `SET NULL` clears terminal contracts).
  4. `DELETE /api/settings/contract-templates/[id]/permanent` + `GET …/[id]/usage` — both `requirePermission("manage_contract_templates")` + org-scoped; permanent route does best-effort `contract-pdfs` storage cleanup. 9 + 4 route tests.
  5. Signing-view degradation — `build-public-signing-view.ts` serves a `signed` contract from its `signed_pdf_path` when the template is gone instead of `template_not_found`; `Contract.template_id` and `PublicSigningView.template` are now nullable; `contract-signer-view.tsx` got a null-template guard. 2 tests.
  6. Templates-list UI — `settings/contract-templates/page.tsx` `⋯` menu gained a destructive "Delete permanently" item with confirm/block dialogs (calls `…/usage` first), toasts, list refresh.
  7. Verification — typecheck clean, lint clean, **full suite 181/181 green** (25 new tests).

## What's next

- **PR #77 needs review + merge.** On merge, issue #76 auto-closes. The migrations are already live on prod, so the PR's code matches the deployed schema — nothing else to apply.
- Still queued, untouched this session: **#58 umbrella** has #62 (Restore voided) + #63 (Permanently delete voided) `ready-for-agent`; the **#68 real-email demo** remains on Eric's plate.

## Open threads

- **Pre-existing soft-archive `DELETE` gap.** `DELETE /api/settings/contract-templates/[id]` (the "Archive" action) still lacks both `requirePermission` and an org filter. The #76 PRD explicitly left this as-is; tightening it is a separate follow-up. The two new #76 routes (`/permanent`, `/usage`) are both correctly gated + org-scoped.
- **Pre-existing unrelated typecheck error.** `src/lib/email/sync-folder-incremental.test.ts` has a `vi.mock` typing error (`TS2322`, ImapFetchedMessage). It predates this session and is untouched — but it means `tsc --noEmit` is not clean repo-wide; filter that one file when checking #76's typecheck.
- **In-flight-block path only exercisable with test contracts.** Per `project_no_real_customers_yet.md` there are no real customers signing on prod, so the `sent`/`viewed` block path is currently reachable only with seeded test contracts.

## Mechanical state

- **Branch:** `claude/76-template-hard-delete` (pushed; tracks `origin`).
- **Commit at session end:** `7431069` (`contracts: permanently delete contract templates (#76)`). Parent is `def65df` (the fifteenth-session PRD handoff commit).
- **`main` HEAD:** unchanged at `def65df` — PR #77 not merged.
- **Uncommitted changes:** none from this work; gitignored `out/` present as always. `00-NOW.md` + this handoff file will be the handoff commit.
- **Migrations applied this session:** two (both build76, listed above), verified against prod.
- **Deployed to Vercel:** n/a — branch not merged; Vercel deploy happens on merge of #77.
- **GitHub:** PR #77 created (OPEN). No issues closed yet (#76 closes on merge).

## Notes for next session

- **The deep module is `template-deletion-eligibility`.** Pure, no DB — the single home of the "may this template be deleted?" rule. The RPC re-encodes the same rule in SQL as the authoritative gate; the `…/usage` endpoint is advisory only (feeds the dialog counts). If the rule ever changes, change both the module and the RPC.
- **The RPC's blocked error is detected by string token.** `hard_delete_contract_template` RAISEs a message containing `template_delete_blocked`; the permanent route maps that substring to HTTP 409, anything else to 500. Keep the token stable if the RPC is ever edited.
- **Graceful degradation only fires for `signed` contracts.** `voided`/`expired` short-circuit before the template load in `build-public-signing-view.ts`; an in-flight (`draft`/`sent`/`viewed`) contract with a missing template still errors `template_not_found` by design. `ContractSignerView`'s null-template guard is type-only — the sign page renders signed contracts via `SignedShell`, which never touches `view.template`.
- **Realistic primary use case:** clearing blank `Untitled Template (N)` rows from smoke testing — zero referencing contracts, simplest deletable path.

## Links

- PR: [#77](https://github.com/ericdaniels22/Nookleus/pull/77) — contracts: permanently delete contract templates (OPEN)
- Issue: [#76](https://github.com/ericdaniels22/Nookleus/issues/76) — Permanently delete contract templates
- Prior session: [[2026-05-15-76-template-hard-delete-prd]]
- Current state: [[00-NOW]]
- Related: [[build-15d]] (contract template overlay builder)
