---
date: 2026-05-08
build_id: build-65b-merge-and-iphone-smoke
session_type: focused
machine: Mac (Vanessa's MacBook Pro) + Eric's iPhone (real-device smoke)
related: ["[[build-65b]]", "[[2026-05-08-build-65b-xcode-cloud-fix]]", "[[2026-04-29-build-65b]]", "[[2026-05-06-build-65a-testflight-build3]]"]
---

# Build 65b Merge + iPhone Smoke Handoff — 2026-05-08

## What shipped this session

**Build-65b camera scaffold MERGED to `main` and FIRST iPHONE SMOKE COMPLETE.** Closes the gating step queued in [[2026-05-08-build-65b-xcode-cloud-fix]] § "What's next" item 1, then drives the §5.2.A iPhone real-device verification (item 2) far enough to confirm the camera + review flows work end-to-end. **Save & exit now exits cleanly to the job detail page.** The expected gap — photos do not appear in the job's photo set — is exactly what 65c is supposed to close (§5.3 of the build-65 plan: "aggressive background upload to Supabase Storage, sync indicator UI, auto-delete after sync"). 65c is now THE next priority with a hard real-device signal that the prereq capture flow works.

**Five commits on `main` pushed to `origin/main`** (plus one merge commit on `origin/build-65b-session-a`):

- `0c7f7eb` **Merge `origin/main` into `build-65b-session-a`** (on the branch). 4 conflicts resolved per [[2026-05-08-build-65b-xcode-cloud-fix]] strategy — `Info.plist` took main's superset (4 NS\*UsageDescription entries; session-a's Camera/Microphone strings matched main's byte-for-byte after the previous session's option-(a) convergence); `package.json` took main's deps + added session-a's `dotenv-cli` to devDependencies; `package-lock.json` `--theirs` (main's) then `npm install` added the dotenv-cli subtree (~46 lines); `src/components/job-detail.tsx` auto-merged cleanly (main's `escapeOrFilterValue` + `EstimatesInvoicesSection` co-exist with session-a's `<CaptureFab jobId={jobId} />`); `ios/App/CapApp-SPM/Package.swift` re-emitted byte-identical to main via `npx cap sync ios`, confirming the previous session's "cap sync 8 leaves a properly-declared Package.swift alone" lesson again. Local verification before push: `npx tsc --noEmit` clean; `npm run build` ✓ (both `/jobs/[id]/capture` and `/estimates/[id]/edit` routes present); `npx cap sync ios` clean (2 plugins found).

- `6a7b66c` **Merge pull request #51 from ericdaniels22/build-65b-session-a.** PR-route over fast-forward-merge-locally per Eric's explicit "do it for me" authorization. PR #51 was MERGEABLE / mergeStateStatus CLEAN with Vercel preview SUCCESS before merge. `gh pr merge 51 --merge` created the merge commit on `main`. Vercel auto-deployed `aaaplatform.vercel.app` from that commit; the iPhone Capacitor app loads the live URL via `capacitor.config.ts:9` `server.url`, so the merge alone propagated the camera scaffold to Eric's iPhone after a force-quit + reopen.

- `e7c09a9` **fix(65b): make body+html transparent during camera capture.** First iPhone smoke attempt: camera UI loaded but the live feed was completely hidden by a near-white block. Root cause: the `@capacitor-community/camera-preview` plugin renders the live feed *behind* the WebView (via `toBack: true`) — the page's `<body>` had `bg-background` applied via Tailwind's `@layer base` rule in `src/app/globals.css:188`, painting a near-opaque oklch(0.985 0.005 250) over where the feed should show through. Added `useEffect` in `src/components/mobile/camera-view.tsx` that sets `document.body.style.backgroundColor = "transparent"` and the same on `document.documentElement` on mount, restores prior values on unmount. Camera live feed visible end-to-end after deploy + force-quit + reopen.

- `7edfebd` **fix(65b): defuse review screen tap-routing on iOS** (insufficient — superseded by `fc4e508` but kept in history for the diagnosis trail). Smoke pass surfaced three review-screen bugs: (1) tile taps sometimes opened a different tile's photo, (2) header buttons (Camera ←, Save & exit) opened tiles instead of navigating, (3) thumbnails had only 4px gap. First fix attempt: defensive `CameraPreview.stop()` on review-screen mount; explicit `setPointerCapture(pointerId)` + pointer-id matching on the tile's pointer handlers; switched tile pointer state from `useState` to `useRef`; bumped `gap-1` → `gap-3`; added `touch-action: manipulation` to the screen root. **None of these fixed the bug** (header buttons still misfired with 18 photos in the grid).

- `fc4e508` **fix(65b): replace absolute-positioned tile button with plain block button** (the actual fix). Eric's narrowing observation — "I only have the button selecting issue when I have a bigger tray (15+ photos)" — pinned the bug to a known WebKit issue: hit-test bounds for `position: absolute` children of a scrollable container can desync from the scroll offset, so iOS routes touches to whichever absolute element overlaps the *unscrolled* bounds — even when the user taps an element entirely outside the scroll container. The previous tile structure was a wrapper `<div class="relative">` with an `<button class="absolute inset-0">` as the click target (so the button could `translateX` for swipe-to-delete). Replaced with a plain block-level `<button class="aspect-square">` that fills the tile naturally; image as a regular `<img>` child. **Trade-off: swipe-to-delete is removed.** Other delete paths preserved — Select mode + batch Delete in the footer, and the Delete button in the expanded photo view, both continue to work. Ripped out `SWIPE_DELETE_THRESHOLD`, the pointer state ref, and the `onSwipeDelete` prop. After deploy + force-quit + reopen, **Save & exit and Camera ← both navigate cleanly even with 18 photos in the grid.**

**Live iPhone smoke results** (Eric's iPhone, AAA prod, signed in as Eric's normal user):

| §5.2.A test | Status | Notes |
|---|---|---|
| FAB visible on `/jobs/[id]` on iPhone | ✅ | Floating action button rendered |
| Tap FAB → camera UI | ✅ after `e7c09a9` | Lived feed visible after body-transparent fix |
| Rapid mode: 20 captures, stays in camera | ✅ | Count reached 20 |
| Tag-after mode: 5 captures with caption/tag | ✅ | All 5 saved |
| Review screen renders 25 thumbnails | ✅ | Layout works |
| Tap to expand individual photo | ⚠️→✅ | Was selecting wrong photo at 15+; fixed by `fc4e508` |
| Header back to Camera | ⚠️→✅ | Was opening tiles at 15+; fixed by `fc4e508` |
| Save & exit | ⚠️→✅ | Was opening tiles at 15+; fixed by `fc4e508` |
| 22 .jpg + 22 .json in `pending-uploads/` after delete 3 | ⏭ | Test 4 deferred — needs Xcode device-files browser dive |
| Battery drain ≤5% after 100 rapid captures | ⏭ | Test 5 deferred to next iPhone session |
| Permission-denied recovery flow | ⏭ | Test 6 deferred to next iPhone session |
| Photos appear in job after Save & exit | ❌ EXPECTED | 65c gap — see "What's next" |

## What's next

**65c — Upload pipeline + offline queue** is now the next build, with the strongest possible justification: real-device smoke confirmed photos save to `pending-uploads/{job_id}/{capture_session_id}/...` on the iPhone but have no path to the `photos` table. Per build-65 plan §5.3:

- **Goal:** photos captured in 65b sync to Supabase Storage automatically. App-private encrypted-at-rest local storage; auto-delete from device after successful sync. Sync indicator UI. Capture works fully offline; queue drains when signal returns. Retries with exponential backoff.
- **Three sessions A/B/C** (the data-integrity surface earns the protocol).
- **Schema additions for 65c** (the only schema 65 introduces) — see plan §5.3 § "Schema additions for 65c".
- **Decision locked from §5.3:** encryption-at-rest is 65c's job, not 65b's; this session did not change that.

Running second priorities (deferred, none blocking 65c):

1. **§5.2.A residual tests** — Tests 4 (file count via Xcode device-files), 5 (battery drain on 100 rapid captures), 6 (permission-denied recovery) deferred to a fresh iPhone session. None block 65c kickoff; 65c will exercise the file-count surface anyway via real upload telemetry.

2. **Camera + review UX cleanup** (filed as 65b follow-ups, none are 65b regressions):
   - **Tag panel doesn't show the just-taken photo.** When Eric tapped shutter in tag-after mode, the tag/caption panel slid up but didn't include a thumbnail of the photo being tagged. Crew tagging "the broken pipe" needs to see the photo. Add a thumbnail at the top of the tag panel sourced from the same `base64Data` that was just persisted; small ~120pt square is enough.
   - **2-photo grid layout looks lopsided.** With <3 photos the third grid column is empty, making the right side feel uneven. Cosmetic; consider `place-content: start` + `auto-fit, minmax(...)` columns or a mixed layout for very small tray sizes. Confirmed by screenshot.
   - **Swipe-to-delete on review tiles regressed in `fc4e508`.** Removed because it required absolute positioning that hit the WebKit scroll bug. If swipe is wanted back, structure the tile so the swipe-translating element is a child of the in-flow click target, not the click target itself.
   - **Xcode build console noise during native install** — UIScene lifecycle deprecation warning (future iOS, not current), Auto Layout grumbles about `_UIButtonBarButton` system toolbars, single `WEBP makeImagePlus err=-50` (one image somewhere on the page didn't decode), `RTIInputSystemClient` keyboard-suggestion churn, "variant selector cell index could not be found" emoji subsystem chatter. All Apple internal / harmless. File for a future native iOS hygiene sweep — not a 65 blocker.

3. **TestFlight refresh so iPhone Home Screen reads "Nookleus"** — the long-standing 65a follow-up. Now that Xcode Cloud is green AND the camera scaffold is on main, this can run via Xcode Cloud's TestFlight integration (preferred over manual archive). Not gated on 65c.

## Decisions locked

- **PR-route over fast-forward-merge-locally for the session-a → main merge.** Three options were presented (PR with Vercel preview + reviewable diff; push branch only without PR; FF locally and push main without preview). Eric replied "whichever you recommend"; recommended PR; he confirmed via "do it for me." The PR's Vercel preview SUCCESS before merge meant we caught any desktop regressions before main moved. In hindsight: would have saved nothing to skip the PR — Vercel runs the same build either way — but the PR gave a single shareable URL for the merge surface.

- **Skip swipe-to-delete on review tiles** in favor of plain block buttons. Direct cause: the absolute-positioned button structure that swipe-to-delete required hit a WebKit scroll-hit-test bug. Replacement delete paths preserved (Select + batch; Delete in expanded view). Reversible if swipe is wanted back, but only by restructuring (transform an inner child, not the click target itself).

- **Direct-to-main pushes for camera fixes**, with the harness's auto-mode classifier blocking direct pushes to main and Eric authorizing each via the `! git push origin main` slash-command pattern. Three pushes this session went via this manual escape hatch. Going forward, a `.claude/settings.json` permission rule (`Bash(git push origin main)` or broader `Bash(git push:*)`) would streamline; not added preemptively because the friction is intentional.

- **Test 4 (file count) skipped at smoke time.** The §5.2.A spec calls for confirming "22 .jpg + 22 .json under `pending-uploads/...`" after delete-3-from-25; the only paths to this on iPhone are an in-app dev-console hook (which doesn't exist in production builds) or Xcode's device-files browser. Both are heavier than the smoke goal warranted. 65c will exercise the surface implicitly via upload telemetry.

- **Body-transparent fix scoped to `CameraView` only**, not `CaptureFlow`. Restores body bg in cleanup so any other route resumes its normal Tailwind theme. The mount-effect sets `prevBodyBg = document.body.style.backgroundColor` and restores that exact value on unmount; if Tailwind's class-based bg is the source (the typical case), `prevBodyBg` is `""` and restoration removes the inline override, falling back to the class.

## Open threads

- **65c upload-pipeline scaffolding is the gating next-build.** Iron's hot — real-device smoke just proved capture works.

- **`build-65b-session-a` branch.** Now 1 commit ahead of where it was at session start (`6362edd → 0c7f7eb`). The branch is fully merged to main via PR #51; it can be deleted without losing history. Not deleted this session because it's referenced from older handoffs and we have no real customers (no urgency).

- **Tests 4–6 of §5.2.A still open.** Battery and permission-denied are valuable to run before 65c lands so we have baseline measurements pre-upload-pipeline; file count is implicit in 65c.

- **Camera + review UX cleanup list** (4 items above) is ~half-day of work; not 65b regressions but real polish gaps surfaced by the smoke. Could be a 65b.1 mini-build, OR rolled into 65c's scratch rehearsal session.

- **WKWebView tap-routing footgun catalogue.** Two third-party / browser-level bugs surfaced this session:
  - `@capacitor-community/camera-preview` v8 leaks a `UITapGestureRecognizer` on the WKWebView when `toBack: true` is used — `stop()` removes the preview view but never the gesture. Confirmed by reading the plugin's Swift source (`node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraPreviewPlugin.swift:138`). Mitigation: defensive `CameraPreview.stop()` from any screen mounted after camera; avoid pointer-event-heavy interactive elements after camera has run in the same app session; vendor a minimal fork if it bites again. **Worth filing upstream** at https://github.com/capacitor-community/camera-preview/issues — patch is ~3 lines (track the recognizer in `start`, remove it in `stop`).
  - WebKit's hit-test bounds for `position: absolute` children of `overflow: auto` containers can desync from the scroll offset. Mitigation: prefer in-flow tap targets when the container scrolls.

- **Standing carry-overs from prior `[[00-NOW]]` unchanged.** Workplan Step 5 (Supabase email templates) still on Eric. AAA QB sandbox token still expired since 2026-04-21. 67c2 reviewer carry-overs F4–F8 still open. 5xx error redactor sweep across remaining ~80 routes still open.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `fc4e508` (the absolute→block-button fix; the handoff vault commit will land on top of this)
- **In sync with `origin/main`:** yes
- **Uncommitted changes in tracked files:** none
- **Untracked:** `out/` (gitignored — cap-sync regeneration target)
- **Migrations applied this session:** none
- **Deployed to Vercel:** four auto-deploys triggered (the merge + three fixes); all SUCCESS by inference (Eric's iPhone tests on the live URL each succeeded after force-quit + reopen)
- **Distributed to TestFlight:** no new build this session (web-only fixes; iPhone loads from live Vercel URL)
- **`build-65b-session-a` branch state:** at `0c7f7eb` on origin (1 ahead of pre-session `6362edd`); fully merged to main via PR #51; safe to delete

## Notes for next session

- **65c kickoff prereq is already satisfied.** Capture writes to `pending-uploads/{job_id}/{capture_session_id}/...`; sidecar JSON written next to each `.jpg`. 65c reads from this prefix per plan §5.2.A's "Hand-off interface to 65c."

- **iPhone load mechanism:** Capacitor app loads `https://aaaplatform.vercel.app` directly via `capacitor.config.ts:9` `server.url`. Web changes (CSS/JS) propagate via Vercel deploy + iPhone force-quit + reopen. Native binary changes (new Capacitor plugins, Info.plist edits) require Xcode Cloud archive + TestFlight (or manual Xcode install) — not relevant to 65c if it's pure JS-side queue + Supabase Storage uploads.

- **Memory saved this session:** `project_no_real_customers_yet.md` — Nookleus prod has no live external customers as of 2026-05-08; production data loss is not a risk factor when planning tests or migrations. Pads scratch-Supabase rituals as overkill; "test against prod, sign in as your normal user" is the default.

- **iPhone test cadence:** force-quit + reopen is enough to pick up Vercel deploys (WKWebView respects HTTP cache headers from Vercel's CDN). If a fix doesn't seem to take, the most likely cause is the deploy still building, not stale cache — `gh api repos/.../commits/{sha}/status` resolves it.

- **Console noise on Xcode build is normal** for this app shell. The two that *might* matter long-term: UIScene lifecycle (Apple deprecation, future iOS), one WEBP image decode failure (some image somewhere on the page; trace-and-fix during a future native hygiene sweep). Everything else is iOS framework chatter.

- **Push-to-main guardrail.** Continues to require `! git push origin main` from Eric's terminal. Could add a permission rule to `.claude/settings.json` to streamline if iteration cadence demands it. Not blocking.

## Links

- Build card: [[build-65b]]
- Current state: [[00-NOW]]
- Predecessor (the merge prerequisite shipped this morning): [[2026-05-08-build-65b-xcode-cloud-fix]]
- Originating session A.5 handoff: [[2026-04-29-build-65b]]
- Source plan: `docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md` § 5.2.A + § 5.3
- PR: https://github.com/ericdaniels22/Nookleus/pull/51
- Apple docs (UIScene lifecycle, future deprecation): https://developer.apple.com/documentation/uikit/uiscene
- Camera-preview plugin source (the leaked-tap-gesture footgun): `node_modules/@capacitor-community/camera-preview/ios/Sources/CameraPreviewPlugin/CameraPreviewPlugin.swift`
