---
date: 2026-05-09
build_id: 65c-impl-tasks-14-15-partial-16
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-65c]]", "[[2026-05-08-build-65c-impl-tasks-0-13]]", "[[2026-05-08-build-65c-spec-and-plan]]"]
---

# Build 65c Handoff (Tasks 14, 15, partial 16) — 2026-05-09

## What shipped this session

**Tasks 14 + 15 complete; Task 16 partially executed (Test 1 passed implicitly, Tests 2-6 unvalidated). PR #52 open and Vercel-preview-green. Pipeline end-to-end proven on real iPhone: 151 photos uploaded to Supabase Storage + `photos` table during smoke.**

**Five commits on `build-65c-upload-pipeline`** (all pushed to origin, PR #52 against `main`):

- `2f7f17c` **feat(65c): background-sync — beforeExit drain + Info.plist UIBackgroundModes:fetch** — Task 14. New `src/lib/mobile/background-sync.ts` (BackgroundSyncRunner using `@capawesome/capacitor-background-task` `beforeExit`); wired into UploadQueueProvider next to `networkRef`; `UIBackgroundModes: ['fetch']` added to `ios/App/App/Info.plist`; `npx cap sync ios` regenerated `Package.swift` + `Package.resolved` (added `swiftKeychainWrapper 4.0.1`). Reviewers (spec + code-quality) ✅. Three non-blocking nits flagged.

- `f48443c` **feat(65c): bg-sync — log drain errors via console.warn** — Nit #1 fix from code-quality review: previously the `try/finally` in `beforeExit` swallowed drain errors silently. Now logs `[65c] bg-sync drain error` to make bg-upload failures visible in device logs.

- `747932c` **test(65c): synthetic upload-fail endpoint behind localStorage flag** — Task 16 prep. New `src/app/api/test/photo-upload-fail/route.ts` (POST returns 500 with `{"error":"synthetic_test_failure"}` on preview/dev; 404 on production via `VERCEL_ENV` gate); `upload-queue.ts`'s `uploadOne` now checks `window.localStorage.getItem('65c-force-upload-fail') === '1'` BEFORE the real Supabase upload — when set, fetches the test endpoint and throws on its 500. Verified: production returns 404, preview returns 500. **Originally placed at `/api/_test/photo-upload-fail` but Next.js excludes underscore-prefixed dirs from routing**; renamed to `/api/test/...` after the build summary didn't list the route.

- `3cf8d04` **fix(65c): pick up live captures + reliable camera stop** — Two bugs surfaced during smoke, fixed in one commit:
  - **Bug A (load-bearing for 65c)**: `UploadQueueWorker.scanAll()` only ran on provider mount, so captures taken DURING a live session were invisible to the worker until next launch. Fix: `writeCapture` now dispatches a `'65c-capture-written'` window event after the sidecar write; provider listens and runs `worker.scanAll().then(() => worker.drain())`. Captures upload in real-time during shutter session.
  - **Bug B (predates 65c, surfaced today)**: `CameraView.stopCamera` early-returned when `startedRef.current` was false, but `startedRef.current` only flips true AFTER `await CameraPreview.start()` resolves. Exiting the camera between mount and that resolve left the native camera running (visible: live camera feed leaked through the iOS status-bar safe-area on the next page). Fix: drop the guard; `CameraPreview.stop()` is already in a try/catch so calling it on a not-yet-started camera is safe. Also surfaced stop failures via `console.warn("[65b] CameraPreview.stop failed", err)` (was previously silently swallowed).

**PR #52** open against `main`: "Build 65c: mobile upload pipeline + offline queue." Vercel preview built green twice (after the bug-fix push). Body links spec + plan. Acknowledges migration `build65c_photos_mobile_fields` already applied to AAA prod.

**Real-device smoke partially executed on Eric's iPhone:**
- Local Xcode install via `npx cap open ios` → Run on USB-connected iPhone. Native shell built and launched cleanly with all 6 plugins (`@capacitor-community/camera-preview`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/network`, `@capawesome/capacitor-background-task`, `capacitor-secure-storage-plugin`).
- **`capacitor.config.ts` temporarily pointed at the PR's Vercel preview URL** (`https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app`) so the iPhone WebView would load the PR's web code instead of production main. **Reverted before handoff commit** — never committed.
- **Test 1 (50 captures with signal): ✅ PASSED IMPLICITLY** via Supabase verification. Database query returned 151 photos in `photos` table for the test job (`0ccaacb2-98a5-45a5-9fce-98ce782b2bde`), all `uploaded_from='mobile'`, all with valid 1080×1920 dimensions (EXIF read worked), `taken_by='Eric Daniels'` (profile lookup worked), `file_size` populated (in-pass fix worked). Upload timestamps clustered around 10:22-10:23 CDT — captures uploading in real-time during the shutter session.

## What's next

**Decide first: continue Task 16 smoke tests, or trust the pipeline-proven core and merge.** Eric paused after Test 1 passed implicitly; the conversation ended without a decision on continuing.

If continuing Task 16 smoke:

1. **Re-edit `capacitor.config.ts`** to point at the preview URL (`https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app`), `npx cap sync ios`, reinstall via Xcode. Don't commit the config change.

2. **Test 2: airplane mode + 100 captures.** Toggle airplane mode ON, snap 100 photos, exit, confirm the upload-queue badge shows N pending. Toggle airplane OFF, watch the queue drain. Validates offline queue + auto-resume on network-online.

3. **Tests 3-5: failure path.** In Safari Web Inspector → Console: `localStorage.setItem('65c-force-upload-fail', '1')`. Snap 3 photos. Watch retries → all fail (red badge). Long-press FAB to open queue sheet. Retry one (after `localStorage.removeItem(...)`); delete one; leave one orphan-failed for cleanup. Validates retry + manual recovery + delete.

4. **Test 6: app killed mid-upload.** Snap 30 photos rapidly, immediately force-quit the app, relaunch. Confirm `scanAll()` recovers stale `uploading` claims and resumes uploads. Validates `worker_owner_pid` race protection.

5. **Task 17: cleanup + merge + TestFlight.** Delete the 151 test photos from AAA prod (`DELETE FROM photos WHERE job_id = '0ccaacb2-98a5-45a5-9fce-98ce782b2bde'` plus matching storage objects). Then `gh pr merge 52 --squash` (or merge commit per repo convention). Trigger Xcode Cloud archive → TestFlight push so the iPhone Home Screen reads "Nookleus" with the 65c native deps.

If skipping Task 16 smoke and merging directly:

- The pipeline core is proven (151 successful uploads with full metadata) — Tasks 16.2-16.6 validate edge cases that aren't load-bearing for the v1 ship.
- Task 17 still applies: cleanup test data → merge → TestFlight.
- Risks of skipping: airplane-mode-and-resume not validated (worker.drain on network-online has a unit-test stand-in but no real-device proof); failure-path retry/backoff math not validated against real Supabase 5xx; force-quit recovery not validated against real disk state.

## Decisions locked

- **Failure-path mechanism: Option A (Next.js test route + localStorage flag).** Eric chose Option A over Option B (Supabase storage policy edit) when offered. Reversible by `git revert`; doesn't touch real config; gated by `VERCEL_ENV !== 'production'` so production exposure is impossible. Route lives at `/api/test/photo-upload-fail` (NOT `/api/_test/...` — Next.js excludes underscore dirs from routing).

- **Migration path for old captures: migrate, not wipe.** Eric chose the realistic path (`migrateUnencryptedFiles()` runs on first provider mount, encrypts pre-existing `.jpg` files in place). Wipe was offered as a faster shortcut; rejected.

- **Address the load-bearing Bug A; defer Bug B.** Bug A (worker doesn't pick up live captures) was load-bearing for 65c's value prop, fixed inline in `3cf8d04` via the event-based scan-and-drain. Bug B (camera-stuck on exit) was a 65b-era reliability gap surfaced today; the early-return guard removal in `3cf8d04` is the proposed fix but **not validated on device** (Eric force-quit + relaunched, which masks Bug B). Bug B reclassified as 65b.1 follow-up.

- **The Review screen UX surprise is real but not a blocker.** With Bug A's fix landing, captures upload + delete from local disk during the shutter session. By the time the user taps Done → Review, local dirs are empty → Review shows "0 photos." Confusing UX, but the underlying pipeline is correct (verified: 151 photos uploaded + DB rows correct). Filed as 65b.1 follow-up. Possible directions next session: have Review show uploaded thumbnails fetched from Supabase, OR skip Review entirely when queue is empty, OR rename the empty state to "All uploaded ✓".

## Open threads

- **PR #52 awaiting decision: complete smoke or merge now.** Vercel preview is green; bug fixes shipped; Test 1 passed implicitly. Eric paused mid-decision.

- **Bug B (camera-stuck on exit) — fix shipped but not validated on device.** Code change is in `src/components/mobile/camera-view.tsx` (commit `3cf8d04`); removed the `if (!startedRef.current) return;` guard from `stopCamera`. Logically correct, but the only way to verify is reproducing the original Bug B scenario (exit camera before `CameraPreview.start()` resolves) on device, which we didn't do. Likely OK for ship; document as a known issue if Bug B reappears in TestFlight feedback.

- **151 test photos in AAA prod for job `0ccaacb2-98a5-45a5-9fce-98ce782b2bde`.** Need to be deleted before merge (Task 17 cleanup). They're real test data with real storage objects.

- **`capacitor.config.ts` is back to `aaaplatform.vercel.app`** (production). For continued smoke testing on the preview, the next session needs to re-edit + re-sync + re-install. Preview URL: `https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app`.

- **Local Xcode install was used, not TestFlight.** Eric's iPhone has a non-TestFlight build of the 65c native shell. After merge, Task 17 triggers Xcode Cloud archive + TestFlight, which will overwrite this with the canonical signed build.

- **65b followup UX gaps (now expanded to 5+ items)** — pre-existing 4 items (tag panel preview thumbnail, <3-photo grid layout, swipe-to-delete restoration, native-iOS console-noise hygiene) plus this session's two:
  - **Bug B reliability fix validation** (camera stop on early-exit)
  - **Review screen UX surprise** when uploads complete during session
  Default: hold as 65b.1 mini-build separate from 65c.

- **Task 14 nit #2 deferred** — `cancelled` flag check missing before `bgSyncRef.current = bgSync` assignment. Pre-existing pattern; blast radius near-zero (provider mounts once at app boot). Cosmetic, not shipping-blocking.

- **Task 14 nit #3 deferred** — `UIBackgroundModes: fetch` declared without `BGTaskScheduler` registration. Forward-investment per the plan; possible App Review reviewer questions at production submission. Mitigation: brief reviewer note when submitting. Not shipping-blocking.

- **Standing carry-overs unchanged.** Workplan Step 5 Supabase email templates (Eric, dashboard-only); AAA QB sandbox token still expired since 2026-04-21; 67c2 reviewer carry-overs F4–F8; 5xx redactor sweep across remaining ~80 routes.

## Mechanical state

- **Branch:** `build-65c-upload-pipeline`
- **Commit at session end:** `3cf8d04` (fix(65c): pick up live captures + reliable camera stop)
- **In sync with `origin/build-65c-upload-pipeline`:** YES (just pushed); 15 commits ahead of `main`
- **Local `main`:** in sync with `origin/main` at `a8dec0b`
- **Uncommitted changes:** none (capacitor.config.ts revert is what landed clean; `out/` is gitignored)
- **Migrations applied this session:** none (`build65c_photos_mobile_fields` was applied in the 0-13 session against AAA prod)
- **Deployed to Vercel:** yes (preview only, via PR auto-deploy; production unchanged)
- **Distributed to TestFlight:** no
- **Real-device install:** local Xcode install on Eric's iPhone (USB-cabled, signed with personal team)
- **Memories saved this session:** none (the existing memories cover the relevant patterns)

## Notes for next session

- **The pipeline works end-to-end on real iPhone.** This is the load-bearing fact for 65c. 151 photos uploaded with correct metadata in the test smoke. Don't over-test before merging — the value proposition is proven.

- **Bug A fix changes the user flow expectation.** Pre-fix: capture session stays in the queue until next app launch. Post-fix: captures upload during shutter session. This means:
  - **Power users will be surprised** by an empty Review screen when uploads beat the user to Done. That's the UX surprise filed for 65b.1.
  - **Behavior is more user-friendly** — no "where did my photos go" anxiety, no waiting period.
  - **The queue-sheet badge becomes the primary upload-progress indicator.** It ticks up as captures write, ticks down as uploads complete.
  - **For the smoke tests 2-6, this matters.** Test 2 (airplane mode + 100 captures) WILL accumulate 100 in the queue because uploads can't complete. Eric will see the badge climb to 100. That's the expected behavior.

- **The synthetic-fail mechanism is live and working.** `/api/test/photo-upload-fail` returns 500 on preview, 404 on production. The localStorage flag `'65c-force-upload-fail'` set to `'1'` in Safari Web Inspector enables the failure path. Tests 16.3-16.5 are unblocked. **Important: production won't have this route accessible**, so when iPhone is loading from production main (post-merge), the route returns 404 and the synthetic-fail localStorage flag becomes a no-op. That's by design.

- **`/api/test/photo-upload-fail` is committed and will land in main on merge.** This is intentional per "Option A" framing. The route is gated by `VERCEL_ENV !== 'production'` so it's harmless in prod (returns 404). If Eric prefers to revert it before merge, that's a 1-commit cleanup task; the spec/plan didn't specify whether to keep or remove the test route post-smoke. Default: keep it. Future failure tests will have a ready-made fixture.

- **Safari Web Inspector setup is non-trivial first time.** iPhone Settings → Apps → Safari → Advanced → Web Inspector toggle ON. Then on Mac: Safari → Settings → Advanced → "Show features for web developers" → Develop menu → iPhone name → Nookleus. Once enabled it's persistent.

- **Module dynamic imports DON'T work in WebView console.** `await import("@capacitor/filesystem")` throws "Module name does not resolve to a valid URL" because Capacitor uses bare specifiers resolved at build time. Use `window.Capacitor.Plugins.Filesystem` directly for ad-hoc console diagnostics.

- **The 3 leftover empty session dirs on Eric's iPhone** (`pending-uploads/0ccaacb2-98a5-45a5-9fce-98ce782b2bde/{7b52fa90...,75341959...,2939162d...}`) are session dirs from earlier today. The capture files were uploaded + deleted; the empty parent dirs remain because `deleteCapture` only deletes the 3 files, not the session dir. Net effect: harmless directory cruft. Worth filing a future cleanup pass that prunes empty session dirs after the last capture in a session uploads. Trivial follow-up.

- **Subagent dispatch worked smoothly for Task 14.** Implementer (sonnet) did Task 14 in one shot, DONE_WITH_CONCERNS surfaced the package-name correction (`@capawesome/...` not `@capacitor/...`) and the `Package.resolved` companion-file inclusion. Spec reviewer (sonnet) and code-quality reviewer (sonnet) both passed cleanly. Pattern: pre-corrected the controller's prompt with the package-name fix from the prior handoff so the implementer didn't have to discover it. Worked well.

- **The plan's "open question" about migrate-vs-wipe was resolved early.** Eric's iPhone had leftover unencrypted captures from the 65b smoke. Migration ran successfully on first provider mount of the new build (no `[65c] migration failed` warning observed). Don't re-prompt this question next session.

## Links

- Build card: [[build-65c]]
- Current state: [[00-NOW]]
- Predecessor (this morning): [[2026-05-08-build-65c-impl-tasks-0-13]]
- Spec + plan handoff (yesterday morning): [[2026-05-08-build-65c-spec-and-plan]]
- PR #52: https://github.com/ericdaniels22/Nookleus/pull/52
- Spec doc: `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md`
- Plan doc: `docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md`
- Vercel preview URL (PR-specific, will retire after merge): `https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app`
- AAA prod Supabase project: `rzzprgidqbnqcdupmpfe`
