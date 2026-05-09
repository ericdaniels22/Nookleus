---
date: 2026-05-08
build_id: build-65c-spec-and-plan
session_type: planning
machine: Mac (Vanessa's MacBook Pro)
related: ["[[build-65c]]", "[[2026-05-08-build-65b-merge-and-iphone-smoke]]", "[[2026-04-29-build-65b]]"]
---

# Build 65c Spec + Plan Handoff — 2026-05-08

## What shipped this session

**Spec + 17-task implementation plan for build 65c — mobile upload pipeline + offline queue.** No code. Three docs-only commits on `main` ahead of `origin/main`, awaiting push by next session (or by Eric if execution starts immediately).

The handoff target is explicit: **next session uses `superpowers:subagent-driven-development` to execute the plan task-by-task.** A fresh subagent per task with two-stage review keeps each task small enough that the implementer doesn't need to load the whole plan into context.

**Three commits, all on `main`, none pushed:**

- `3a667ef` **spec: build 65c — mobile upload pipeline + offline queue (design)** — 510 lines at `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md`. Locks 11 decisions, lists scope additions + out-of-scope items, full architecture diagram, file table (created vs modified), migration SQL with rollback, sidecar JSON shape post-65c, per-photo data flow with the 7-step pipeline, encryption design with code, error handling matrix, sync indicator UI sketch, full test list (19 tests retained from plan §5.3.B), sequencing within the single session (11 ordered checkpoints), risks (5), and "Open questions" section (3 items resolvable at plan time).

- `f6503d6` **spec(65c): correct INSERT shape — drop orientation, add file_size** — 22 line additions, 5 deletions. Self-review caught two bugs against the actual `public.photos` schema (verified via `mcp__claude_ai_Supabase__list_tables` against `rzzprgidqbnqcdupmpfe`): (a) no `orientation` column exists on the `photos` table, so the spec's INSERT shape was hallucinating a column; EXIF orientation is now read into the sidecar but NOT written to DB until a future build adds the column; (b) web upload writes `file_size`, mobile must too — `blob.size` at upload time is free. Also annotated the `taken_by` column-default-of-`'Eric'::text` so the in-pass fix is explicitly aware of it.

- `091b319` **plan(65c): implementation plan — 17 tasks (incl 9b), single-session AAA prod** — 2318 lines at `docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md`. Bite-sized TDD-style tasks; pure-logic modules (crypto-vault, exif-read, upload-queue backoff/race math) get red→green→commit cycles via vitest (added as a new dev dep in Task 1); Capacitor-bound modules (filesystem, network, bg-task, secure-storage) stay smoke-tested per existing repo convention. One mid-session ordering bug found in self-review: Task 9's `scanAll` was calling `updateSidecar` before Task 9b loosened its signature → switched to `persistSidecar` (the worker's local helper) instead. Inline fix; same commit.

## Decisions locked

These supersede plan §5.3's locked decisions where they conflict. All four were explicit Q&A with Eric this session.

- **Single session against AAA prod.** Plan §5.3 prescribed three sessions A/B/C with scratch-Supabase rehearsal in B; collapsed to one session per Eric's verbatim "I don't need a scratch session. I don't have any real data on my app." All §5.3.B test cases retained, run against AAA prod. Saved as feedback memory `feedback_no_scratch_supabase.md` so future plan-mandated A/B/C splits get collapsed by default.

- **Encryption-at-rest stays.** AES-256-GCM via `crypto.subtle`, key in iOS Keychain via a Capacitor secure-storage plugin (concrete pick deferred to Task 0 — 3 candidates listed). Per-file random 12-byte IV prefixed on the ciphertext.

- **Background sync stays — but scoped to `BackgroundTask.beforeExit` + foreground-on-resume drain, NOT full `BGTaskScheduler` system-scheduled wake-ups.** `@capacitor/background-task` doesn't wrap the iOS `BGTaskScheduler` API; the `beforeExit` helper drains queue when the user backgrounds the app, and the existing `App.addListener('appStateChange')` in the provider drains on return-to-foreground. True system-scheduled wake-ups would need ~50 lines of Swift in `AppDelegate.swift`; flagged in spec risks but NOT in this build's scope.

- **EXIF read at upload time, not capture time.** Capture path stays fast. Upload worker decodes the blob via `exifr` immediately before INSERT. Eric explicitly chose this over the read-at-capture or fix-the-display-layer alternatives after a "plain terms" clarification.

- **Sync indicator = FAB badge on `/jobs/[id]`.** Numeric badge overlays `<CaptureFab>`; long-press opens a bottom-sheet queue UI with retry / delete-failed actions. No global header strip. (The "both" option from the brainstorm was the most code; Eric picked the recommended FAB-only.)

## What's next

**Execute the plan via `superpowers:subagent-driven-development` in a fresh session.** Sequence:

1. **Read the spec + plan first.** Spec at `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md`; plan at `docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md`.

2. **Push the 3 docs-only commits to `origin/main`.** They're sitting on Vanessa's MacBook only. Either Eric pushes via `! git push origin main` or the next session asks. Pushing now means the spec + plan are visible on GitHub before any code lands.

3. **Task 0 first.** Pick the Keychain plugin from 3 candidates (`capacitor-secure-storage-plugin`, `@capacitor-community/keychain`, `capacitor-secure-storage`). Verify Capacitor 8 compat via `npm view`; whichever the pick, record it in the spec's "Open questions" section + commit.

4. **Then sequentially through Tasks 1–17.** Subagent-driven-development pattern: dispatch a fresh subagent per task with the task body verbatim + "report what you did and what you ran." Review between tasks; halt on any unexpected divergence.

Two open items in the spec that Task 0 is meant to resolve at plan execution time:

- **Failure-path test mechanism.** Task 16 step 6 sketches two options: (a) temporary `/api/_test/photo-upload-fail` route gated by `NODE_ENV !== 'production'`, OR (b) temporary Supabase storage policy that rejects uploads. Pick at execution time; (a) is cleaner, (b) is more realistic.

- **Migrate-vs-wipe of existing 65b smoke captures on Eric's iPhone.** Migration is the correct shipping code path either way (`crypto-vault.migrateUnencryptedFiles()` is in Task 5 + invoked from Task 10's provider). Wiping is the faster test path. If Eric's iPhone has any leftover unencrypted .jpg files from the 65b smoke session, Task 16 step 9 (encryption verification via Xcode device-files) wants them gone. Either run the migration on first install of the new build, or manually delete the `Documents/pending-uploads/` tree via Xcode device-files before reinstall.

## Decisions still open (deliberately, for execution-time choice)

- **Whether to push the 3 docs-only commits before execution starts.** Eric's call. Plan execution will accumulate many more commits; pushing now lets the spec + plan land on GitHub even if execution stalls.

- **Whether to bundle Eric's 65b followup UX gaps (4 items from [[2026-05-08-build-65b-merge-and-iphone-smoke]]) into 65c or hold for a separate 65b.1.** Default per the prior handoff: hold separately. 65c is busy enough.

## Open threads (carried forward)

- **65b followup UX cleanup list (4 items).** Tag panel preview thumbnail; <3-photo grid layout; swipe-to-delete restoration; native-iOS console-noise hygiene sweep. Not 65b regressions; could be a 65b.1 mini-build OR rolled into 65c's smoke session if cheap.

- **§5.2.A residual tests 4–6.** File count via Xcode device-files, 100-rapid battery drain, permission-denied recovery. None block 65c kickoff; 65c exercises file-count implicitly via upload telemetry.

- **TestFlight refresh so iPhone Home Screen reads "Nookleus."** Long-standing 65a follow-up. 65c will trigger an Xcode Cloud archive + TestFlight push as part of Task 17, which addresses this incidentally.

- **`build-65b-session-a` branch.** Still at `0c7f7eb` on origin, fully merged via PR #51, safe to delete. Not done; no urgency.

- **Standing carry-overs unchanged.** Workplan Step 5 Supabase email templates (Eric, dashboard-only); AAA QB sandbox token still expired since 2026-04-21; 67c2 reviewer carry-overs F4–F8; 5xx redactor sweep across remaining ~80 routes.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `091b319` (the plan commit)
- **In sync with `origin/main`:** **NO — 3 commits ahead** (`3a667ef`, `f6503d6`, `091b319`); `origin/main` is at `cb49e9f` (the prior session's vault handoff)
- **Uncommitted changes in tracked files:** none
- **Untracked:** `out/` (gitignored — cap-sync regeneration target)
- **Migrations applied this session:** none (Task 2 of the plan applies the 65c schema migration; not yet executed)
- **Deployed to Vercel:** no (docs-only commits don't change app surface; Vercel will rebuild but no behavior change)
- **Distributed to TestFlight:** no
- **Memories saved this session:** 1 — `feedback_no_scratch_supabase.md` (collapse plan-mandated A/B/C scratch-rehearsal sessions into single AAA-prod sessions by default; confirmed by Eric on 2026-05-08)

## Notes for next session

- **Sub-agent driven development is the explicit handoff target.** Per Eric's `/handoff to prep sub agent driven development in a fresh session`. Fresh session opens, runs `/orient`, reads this handoff, reads the spec + plan, then invokes `superpowers:subagent-driven-development` and starts dispatching task-by-task.

- **Vitest is a new dev dep** added in Task 1. If Eric wants to revisit that choice (the repo has no test framework today; this is a meaningful addition), now is the time to flag — the plan can drop unit tests and rely on smoke for everything if preferred. Recommendation: keep vitest. The crypto-vault, exif-read fallback, and upload-queue retry/race math genuinely benefit from unit tests; data-integrity bugs surfacing only on prod-iPhone-smoke is risky for the WHOLE POINT of 65c.

- **Supabase migration in Task 2 is the first irreversible step.** Two new columns + a partial unique index, applied to AAA prod via `mcp__claude_ai_Supabase__apply_migration`. Rollback SQL is in the plan + appended to the spec. Default-`'web'` on `uploaded_from` means the migration is forward-compatible — existing web upload code paths produce correct rows immediately, even before the in-pass code change in Task 3 lands.

- **iPhone load mechanism for testing.** Web changes propagate via Vercel deploy + iPhone force-quit + reopen (Capacitor `server.url` points at `aaaplatform.vercel.app`). NEW NATIVE DEPS in 65c (`@capacitor/network`, `@capacitor/background-task`, the chosen Keychain plugin) require a NEW NATIVE BUILD — either local Xcode install on Eric's iPhone (faster for smoke) or wait for Xcode Cloud archive + TestFlight (cleaner). Plan defaults to local Xcode install for smoke, then Xcode Cloud + TestFlight after merge.

- **Push-to-main guardrail still in effect.** Plan Task 15 opens a PR (PR-route preferred per [[2026-05-08-build-65b-merge-and-iphone-smoke]] decisions); Task 17's merge happens via `gh pr merge`. No direct pushes to main expected during 65c execution.

- **Memory `project_no_real_customers_yet.md` is load-bearing.** Underpins the single-session-prod decision. If real customers materialize during 65c execution, the plan's risk profile changes — at minimum, swap to scratch Supabase for the failure-path test, and re-read the cleanup steps in Task 17 for "now there's real data adjacent to test data" hazard.

- **The plan has notable deviations from master plan §5.3.** Captured at the bottom of the spec under "Locked decisions for 65c" + in this handoff. The deviations are smaller than they look — single-session vs A/B/C is process; `beforeExit` vs `BGTaskScheduler` is scope; EXIF placement is internal — but worth a re-read by anyone who comes to 65c expecting the master plan's prescription.

## Links

- Build card: [[build-65c]]
- Current state: [[00-NOW]]
- Predecessor (the 65b merge + iPhone smoke that surfaced 65c as the gated next priority): [[2026-05-08-build-65b-merge-and-iphone-smoke]]
- Source plan §5.3 (the master plan): `docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md`
- 65c spec: `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md`
- 65c plan: `docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md`
- AAA prod Supabase project: `rzzprgidqbnqcdupmpfe`
