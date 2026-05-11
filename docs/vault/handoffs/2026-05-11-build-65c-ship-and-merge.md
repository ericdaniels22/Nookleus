---
date: 2026-05-11
build_id: 65c-ship-and-merge
session_type: investigation + implementation + ship
machine: Vanessas-MacBook-Pro.local
related: ["[[build-65c]]", "[[2026-05-09-build-65c-test-2-findings]]", "[[2026-05-09-build-65c-impl-tasks-14-15-partial-16]]", "[[2026-05-08-build-65c-impl-tasks-0-13]]", "[[2026-05-08-build-65c-spec-and-plan]]"]
---

# Build 65c Handoff (ship + merge) — 2026-05-11

## What shipped this session

**Build 65c merged to `main` via PR #52** (merge commit `5877bbe`, merged 2026-05-11 20:51:36 UTC). Finding B (the queue-drain anomaly from the 2026-05-09 evening session) was investigated, resolved as **H1 real upload-loss confirmed**, root-caused, fixed, verified on real iPhone against AAA prod, and shipped. Stranded captures recovered. Test data cleaned.

Five commits on `build-65c-upload-pipeline` this session (all pushed):

- `3d005f7` `fix(65c): pause upload worker when offline; backfill legacy sidecars` — the Finding B fix (4 source files: `upload-queue.ts` adds `setOnline()` + pessimistic `isOnline = false` default + `drain()` early-return when offline + `needsUploadStateBackfill()` pure helper used in `scanAll()`; `network-monitor.ts` changes `start(onOnline)` → `start(onChange)` emitting both edges + initial getStatus; `upload-queue-context.tsx` wires `setOnline(online)` + drain-only-when-online; `upload-queue.test.ts` adds 8 vitest cases for `needsUploadStateBackfill`). 20/20 vitest passing, `tsc --noEmit` clean.
- `5785fb5` `vault: build-65c card capturing Findings A, B (resolved), C` — new `docs/vault/builds/build-65c.md` with the diagnostic narrative.
- `01068ea` `merge: main into build-65c-upload-pipeline` — single conflict in `docs/vault/00-NOW.md` resolved by keeping the branch's newest `last_verified` and slotting main's 2026-05-08 0-13 IMPL entry into the ARCHIVED chain chronologically. Also bundled the post-verification update to `build-65c.md` (status: ready-to-merge).
- (PR #52 merge commit `5877bbe` on `main` — created by GitHub on merge, not authored locally.)

## Finding B resolution — the diagnostic chain

Five hypotheses entered the session as priors per the prior handoff. The resolution path:

1. **DB-side count via Supabase MCP.** Prior handoff's query used non-existent column `uploaded_at`; corrected to `created_at`. Filtered on `job_id = '0ccaacb2-...' AND uploaded_from = 'mobile' AND created_at >= '2026-05-10 02:00:00+00'`: **48 photos landed in Test 2 evening window, 163 in Test 1 morning window** (handoff said 151 — drift of ~12).
2. **Web UI cross-check via Chrome MCP** on `aaaplatform.vercel.app/jobs/0ccaacb2-.../photos`: Photos tab badge `211`, exact match to DB (163 + 48). **H2 (web-UI stale) ruled out** on the web view — Vanessa's "few of 100" was iPhone-specific or referring to a different UI surface.
3. **Capture-rate analysis.** Test 2 evening `taken_at` distribution: 48 captures over 35 seconds = ~0.7s/shot avg. Morning Test 1 distribution: 162 inter-capture gaps, min 0.549s. **Hardware ceiling is ~0.5-1s/shot** — 100 captures in 35s would require 0.35s/shot, physically impossible. Initially pointed at **H6 (badge inflated; only 48 fired)** as strongest prior. **H3 (still draining) ruled out** because drain completed at 03:10:04 UTC in 15s. **H5 (pagination) ruled out** — single dated group.
4. **On-device sidecar audit via Safari Web Inspector + Capacitor.Plugins.Filesystem.** First audit failed because of an inner-readdir on a stray `test-write.txt` file in the job directory; second deep-audit succeeded. **Found 52 sidecars in session `dea218ba-...` all `upload_state: failed`, `retry_count: 4`, `last_error: "Load failed"`**, taken_at spanning **02:48:41 → 02:49:05 UTC** — i.e., the FIRST 52 captures of Test 2 (before the 48 that landed). 52 failed + 48 succeeded = **100 = Vanessa's badge claim, accurate**. **H6 ruled out, H1 confirmed.** H4 also ruled out: every capture wrote a sidecar.
5. **Plus Finding C surfaced as bycatch:** the OTHER job dir `9d5e7fda-...` (Jadon Daniels' WTR-2026-0020) had **87 sidecars across 8 sessions all in `upload_state: 'unknown'`** — pre-65c data where the field didn't exist yet. The upload-queue worker filters `eligible()` by `upload_state === 'pending'` so these 87 were silently invisible to the queue.

**Failure mechanism reconstructed:** Airplane mode was ON when Vanessa started snapping at 02:48:41 UTC. Captures 1-52 fired upload attempts immediately via the `'65c-capture-written'` event listener (added in `3cf8d04`). Each `fetch()` returned WKWebView's `"Load failed"`. The worker burned through retry budget `[1s, 5s, 30s]` per capture → `MAX_RETRIES=3` exceeded → sidecar marked `failed` (with `retry_count: 4`). By 02:49:06 the `@capacitor/network` plugin's offline event had fired and silenced new attempts; captures 53-100 queued as `pending` without immediate fetch. Airplane mode OFF at ~03:09 UTC → drain triggered → 48 pending uploaded cleanly to DB. The 52 `failed` sidecars stayed in `failed` (worker doesn't auto-retry failed items; requires manual retry from queue-sheet UI).

## Fix verification (real-iPhone, AAA prod)

Three end-to-end smoke runs against the deployed fix:

| Test | Captures | Landed in DB | Mechanism exercised | Result |
|---|---|---|---|---|
| Finding C backfill | 87 | **87** | `scanAll()` promotes `unknown` → `pending`; `NetworkMonitor` reports online; worker drains | ✅ |
| Finding B repro (airplane-mode burst) | 35 (5 baseline online + 30 offline) | **35** | Worker holds offline captures as `pending`; `setOnline(true)` on reconnect triggers `drain()` | ✅ |
| Stranded recovery (the original 52 from 2026-05-09) | 52 | **52** | Long-press CaptureFab → upload-queue sheet → retry-all-failed UI action → `worker.retry()` per item resets to `pending` and drains | ✅ |

**Zero data loss across 174 captures.** PR #52 unblocked.

## Decisions locked

- **Option C "pause/resume worker on network state"** picked over Option A (per-attempt status check) and Option B (error-class heuristic). Reason: cleanest model, matches what the design "should have been" from start, composes naturally with the Finding C backfill.
- **Pessimistic isOnline default = false** (not true). Provider's initial `NetworkMonitor.start()` callback flips it to the real state immediately. Prevents a brief window of offline-bug recurrence at app launch.
- **Removed the standalone `worker.drain()` call after `scanAll()`** in the provider — now triggered exclusively by the initial NetworkMonitor edge callback (avoids one wasted no-op drain in the pessimistic case).
- **Don't auto-retry `failed` items in the fix.** They need manual user intent (retry-all-failed UI action exists from `1a1e8fe`). Reason: a true server-side failure shouldn't loop forever; user retries are the right escalation. Fix prevents *new* permanent-failures from offline state, doesn't change recovery semantics.
- **Test 6 (force-quit recovery) skipped** per Eric. Implicitly exercised today via kill+relaunch cycles between commits.
- **Cleanup split-scope:** test job `0ccaacb2-...` (WTR-2026-0021, synthetic contact "65c smoke 2026-05-09") fully deleted (job row + contact row + 298 photos + 464 storage objects including orphans); Jadon Daniels' job `9d5e7fda-...` (WTR-2026-0020) preserved entirely (job row, contact, 11 attached contracts) but its 87 leftover test photos + 107 orphan storage objects under its path deleted.

## Cleanup tally (AAA prod, Task 17)

- **385 photo rows** deleted (298 from `0ccaacb2-...` + 87 from `9d5e7fda-...`, all `uploaded_from='mobile'`)
- **571 storage objects** deleted from `photos` bucket (385 referenced + 186 orphans from prior test runs that the photo-row-keyed delete missed)
- **1 job row** deleted (`0ccaacb2-...`, WTR-2026-0021)
- **1 contact row** deleted (`5602081f-...`, synthetic "65c smoke 2026-05-09")
- **Storage admin escape** used: `SET LOCAL storage.allow_delete_query = 'true'` per the build-15d Task 29 pattern
- **Final verification:** `photos_in_test_jobs = 0`, `storage_objs_in_test_paths = 0`, Jadon's job + 11 contracts intact

## Mechanical state

- **Branch state:** `build-65c-upload-pipeline` deleted from origin via `gh pr merge --delete-branch`. Local branch still exists at `01068ea` (the merge commit on the branch side, pre-PR-merge).
- **Local `main`:** in sync with `origin/main` at `5877bbe` (the PR #52 merge commit)
- **Working tree:** clean except gitignored `out/`
- **Migrations applied this session:** none (build65c_photos_mobile_fields already on prod from the 0-13 session)
- **Deployed to Vercel:** PR #52 preview built green twice (post-fix push, post-merge push) and the merge commit auto-deployed to production via the Vercel main-branch hook
- **Distributed to TestFlight:** no (separate decision when ready)
- **Real-device install:** Eric's iPhone has the preview-URL Capacitor build installed; after PR merge, the WebView automatically picks up production bundle from `aaaplatform.vercel.app` since `capacitor.config.ts` is reverted to production URL on the merged code
- **Memories saved this session:** 1 — `project_photos_table_no_uploaded_at.md` (the `photos` table has no `uploaded_at` column; use `created_at` for upload-time queries)

## Open threads (not 65c blockers; future-session work)

- **Finding A — offline-shell stranding** (deferred to ~Build 67 "offline shell"). The Capacitor WebView loads the live Next.js app via `server.url`; `webDir: 'out'` is essentially empty. Going offline mid-session strands the user on "Connecting…" if they navigate. Three architectural options surfaced in brainstorming on 2026-05-09: A (recommended) new mobile-only `(mobile)/jobs` page client-rendered with cached job list; B make shared `/jobs` offline-capable (big rewrite + web-app risk); C mobile landing + shared web routes deeper (re-creates the bug on first navigation).
- **TestFlight push** — separate decision when ready. The merged code is the 65c implementation; pushing to TestFlight requires Xcode Cloud build + App Store Connect dance.
- **Tests 3-5 (failure-path) + Test 6 (force-quit recovery)** — unrun on PR #52. The synthetic-500 endpoint at `/api/test/photo-upload-fail` is still in code (gated by `VERCEL_ENV !== 'production'`); could be run any time. Lower priority post-fix since Finding B was the failure path that mattered.
- **65b.1 follow-up list** (~6 items): Bug B device-validation (CameraView.stopCamera early-return), Review-screen "0 photos" UX (everything uploaded faster than expected), tag-after preview thumbnail, <3-photo grid layout, swipe-to-delete restoration, Xcode build console noise.
- **Step 5 Supabase email templates** (workplan, unchanged).
- **AAA QB sandbox token** expired 2026-04-21 (unchanged).
- **67c2 reviewer F4–F8** (unchanged).
- **5xx redactor sweep** across remaining ~80 routes (unchanged).

## Notes for next session

- **Build 65c is shipped to `main`.** The next build can be picked from the open-threads list. Strongest candidates: TestFlight push (close the 65 series to a distributable artifact); Build 67 offline-shell (Finding A's home); Build 65d mobile-responsiveness audit (already-queued per build-65a card).
- **The "Load failed" string is WKWebView's generic offline fetch error**, not a Supabase or auth issue. Future debugging of mobile-only fetch failures should suspect network state first.
- **Finding C is now a class of bug worth watching for in other places**: any code path that filters by an enum-string field can silently exclude legacy records where the field was missing or had a different value. `scanAll()`'s backfill pattern is reusable elsewhere if similar surfaces.
- **Don't trust the prior handoff's SQL verbatim** — it had `uploaded_at` (doesn't exist) instead of `created_at`. Memory now saved. The pattern of "handoff suggests a query, query has a typo, you re-derive the right one against schema" might recur; default to schema-check first.
- **Real-iPhone smoke via Safari Web Inspector is the highest-leverage debugging tool** for this build. The deep-audit script (`window.__deepAudit`) reads Capacitor's `Filesystem` plugin directly and gives you full sidecar visibility without needing Xcode device-files browser. Saved as a useful pattern for future iPhone-side investigations.
- **The split-scope cleanup pattern** worked: figure out which test-data belongs to a real-customer surface and split DELETE statements accordingly. Always check `contracts` / `estimates` / `invoices` / `payment_requests` / `photos.uploaded_from` before nuking a job.

## Links

- Build card: [[build-65c]]
- Current state: [[00-NOW]]
- PR #52 (MERGED): https://github.com/ericdaniels22/Nookleus/pull/52
- Merge commit: `5877bbe`
- AAA prod Supabase project: `rzzprgidqbnqcdupmpfe`
- Predecessors: [[2026-05-09-build-65c-test-2-findings]], [[2026-05-09-build-65c-impl-tasks-14-15-partial-16]], [[2026-05-08-build-65c-impl-tasks-0-13]], [[2026-05-08-build-65c-spec-and-plan]]
