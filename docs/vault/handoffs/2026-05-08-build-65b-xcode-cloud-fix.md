---
date: 2026-05-08
build_id: build-65b-xcode-cloud-fix
session_type: focused
machine: Mac (Vanessa's MacBook Pro)
related: ["[[build-65b]]", "[[2026-05-08-build-65b-xcode-cloud-triage]]", "[[2026-05-06-build-65a-testflight-build3]]", "[[2026-04-29-build-65b]]"]
---

# Build 65b Xcode Cloud Fix Handoff — 2026-05-08

## What shipped this session

**Xcode Cloud archive failures CLOSED.** Eric verbatim "just finished — green." The "App -- Build NN failed (main)" email storm that had been triggering on every commit since `b388106` (2026-05-06) stops here. Closes the punchlist queued in [[2026-05-08-build-65b-xcode-cloud-triage]].

**Two commits on `main`, both pushed to `origin/main`:**

- `2fdf5e6` **build(65b): finish camera + filesystem plugin install for Xcode Cloud** — the 6-step punchlist as a single feature commit. 4 files / +50.
  - `package.json` + `package-lock.json`: `@capacitor-community/camera-preview ^8.0.1` + `@capacitor/filesystem ^8.1.2` declared in `dependencies` (not `devDependencies` — runtime-shipped to iOS via the SPM local-path mechanism). `npm install --save` reported "added 4 packages, removed 14 packages, changed 6 packages."
  - `ios/App/CapApp-SPM/Package.swift`: **unchanged on disk** — `npx cap sync ios` re-emitted it identically because the npm declarations now match what was already there. The strip-and-revert dance from build 3 ([[2026-05-06-build-65a-testflight-build3]] § "What shipped") is no longer happening. cap sync output: "Found 2 Capacitor plugins for ios: @capacitor-community/camera-preview@8.0.1, @capacitor/filesystem@8.1.2"; both `.package(...)` entries (lines 15-16) and `.product(...)` entries (lines 24-25) retained.
  - `ios/App/ci_scripts/ci_post_clone.sh` (executable, 0755): `npm ci && npx cap sync ios` from `$CI_PRIMARY_REPOSITORY_PATH`. Apple-canonical location alongside `ios/App/App.xcodeproj`.
  - `ios/App/App/Info.plist`: 4 new usage-description entries.
    - `NSCameraUsageDescription` + `NSMicrophoneUsageDescription`: lifted **verbatim** from `build-65b-session-a` branch's Info.plist via `git show build-65b-session-a:ios/App/App/Info.plist`. Option-(a) convergence per the triage handoff — main and branch now agree on the Camera/Microphone strings, so the eventual `build-65b-session-a` → `main` merge will have zero Info.plist conflict on those entries. Branch's session-a code references microphone for "short voice notes alongside job-site photos" (per the "voice notes" copy in the string), so even though the punchlist only listed Camera, including Microphone matches branch's actual feature surface.
    - `NSPhotoLibraryUsageDescription` + `NSPhotoLibraryAddUsageDescription`: new on main; branch will pick these up cleanly at merge time. Both required by `@capacitor-community/camera-preview`'s photo-library access path.
  - Local verification before commit: `npx tsc --noEmit` clean (silent); `npm run build` ✓ Compiled successfully in 6.7s; `plutil -lint Info.plist` OK.

- `218f446` **build(65b): install Node in Xcode Cloud post-clone before npm ci** — single follow-up commit after Build 89 failed on `2fdf5e6` with `Running ci_post_clone.sh script failed (exited with code 127)`. 1 file / +3 / -1.
  - Build 89 cascade: `ci_post_clone.sh` exit 127 ("command not found") → `npm ci` never ran → `node_modules/` empty → xcodebuild then logged the same SPM resolution failures as before (`/Volumes/workspace/repository/node_modules/@capacitor-community/camera-preview doesn't exist in file system` + same for `@capacitor/filesystem`).
  - Root cause: **Xcode Cloud's default macOS image does not ship Node.** Apple's images are minimal — `brew` is pre-installed but `node`/`npm`/`npx` are not on `$PATH`. The triage handoff flagged this as the next-most-likely failure mode; it materialized on the first post-push build.
  - Fix: prepend `brew install node` and switch `set -e` → `set -ex` (so any future failure shows verbatim which command exited).
  - Build 90 (the post-`218f446` archive) shipped **green**, confirmed by Eric viewing the App Store Connect email feed in `/email`.

## What's next

**Eric explicitly requested a fresh session for the broader build-65b work** — note in `/handoff` invocation: "I want to continue build 65 in a fresh session." The fix shipped this session removes the CI gating; the camera capture work itself is still on the roadmap. Resume points (in priority order):

1. **Merge `build-65b-session-a` → `main`.** Branch is 4 commits ahead of `3d5c222` on origin (`7738e8a`, `f244727`, `874a542`, `6362edd`), untouched since 2026-04-29. Per [[2026-04-29-build-65b]]: `<CameraView>` + `<ReviewScreen>` + `<CaptureFab>` + Capacitor-only `(mobile)/jobs/[id]/capture/` route + `src/lib/mobile/` Filesystem-backed storage helpers + scratch Supabase project setup. Likely conflict surfaces:
   - `src/components/job-detail.tsx` — `<CaptureFab>` integration site; main has churned through 15-series + 67-series.
   - `package.json` — diverged significantly through 15d/15e/15h/67c2/67d/67e/67f/15h-followups. Both sides now declare camera-preview + filesystem (after this session), so those entries should merge cleanly.
   - `ios/App/App/Info.plist` — should now merge **without conflict** because this session preemptively converged the Camera/Microphone strings to branch's exact text.
   - `ios/App/CapApp-SPM/Package.swift` — header says "DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands." Strategy: take whichever side, then run `npx cap sync ios` post-merge to re-emit canonically.

2. **§5.2.A iPhone real-device verification** per [[2026-04-29-build-65b]] § "What's next": iMessage `.env.scratch.local` from Vanessa's MacBook to Eric's Mac, `git pull`, `npm install`, `npx dotenv -e .env.scratch.local -- npm run dev`, sign in as `eric+scratch@aaacontracting.com`, `npx cap sync ios`, `npx cap open ios`, install on iPhone via USB, run the 20 rapid + 5 tag-after smoke (delete 3, Done; confirm 22 .jpg + 22 .json under `pending-uploads/...`), battery-drain check after a 100-shot rapid session, permission-denied recovery flow.

3. **Refreshed TestFlight upload from Mac** so iPhone Home Screen reads "Nookleus" — long-standing 65a follow-up. Now that Xcode Cloud is green, this can either come via Xcode Cloud's TestFlight integration (if configured for the AAA app record) or via Vanessa's manual archive flow per [[2026-05-06-build-65a-testflight-build3]]. Xcode Cloud route is preferred — manual archive's strip-and-revert workaround is no longer needed.

4. **Still deferred** per [[2026-04-29-build-65b]]: EXIF read for width/height/orientation (Session A scaffold writes `0/0/1` placeholders); encryption-at-rest for on-device files (locked to 65c per plan §5.3 decision 2); 65c upload-pipeline scaffolding (depends on 65b real-device verification landing).

## Decisions locked

- **Option-(a) Info.plist convergence over option-(b) merge-first.** Eric's punchlist offered (a) cherry-pick branch's Info.plist edits into main now, vs (b) merge `build-65b-session-a` first then add only missing entries on main. Picked (a) because it's the one-commit path and decouples Xcode Cloud unblock from the still-incomplete iPhone smoke verification on the branch. Outcome: when the branch eventually merges to main, Info.plist diffs cleanly on the Camera/Microphone lines because both sides hold byte-identical strings.

- **`brew install node` over `nvm` / specific Node pin** for the Xcode Cloud post-clone script. Brew's default Node is recent enough (Xcode Cloud's brew is kept current); pinning would create an ongoing maintenance task. If a Node version mismatch ever surfaces (e.g. a dependency requires `engines.node >= 22`), revisit by adding `brew install node@22` + `brew link --overwrite node@22` rather than introducing a Node version manager.

- **`set -ex` over `set -e`** in `ci_post_clone.sh`. The `-x` flag makes the next iteration of any failure single-shot — the build email shows verbatim which command exited. Cost is a slightly noisier success log, which is fine.

## Open threads

- **`build-65b-session-a` branch still on origin, untouched since 2026-04-29.** HEAD `6362edd`, 4 commits on top of `3d5c222`. The merge is the gating step for §5.2.A iPhone verification and 65c upload-pipeline scaffolding.

- **`out/index.html` regeneration discipline.** `out/` is gitignored, but `cap sync` requires `out/index.html` to exist before it'll copy a stub into the iOS bundle. This session didn't need a hand-recreate (the file was still present locally from the prior cap sync); on a fresh clone it would need to be touched. The Xcode Cloud post-clone script now runs `npm ci && npx cap sync ios` — if a fresh `cap sync` against a missing `out/index.html` ever errors, the fix is to add `mkdir -p out && [ -f out/index.html ] || echo '<html></html>' > out/index.html` before the cap sync line. (Did not add it preemptively because Build 90 succeeded without it — meaning either Xcode Cloud's default fresh clone produces a sufficient state, or `cap sync` on Capacitor 8 tolerates a missing `out/`.)

- **No App Store Connect API key configured locally.** Per [[2026-05-06-build-65a-testflight-build3]] line 56-58 — `~/.appstoreconnect/private_keys/` is empty. Xcode Cloud now handles its own signing/upload via App Store Connect integration, so this is no longer blocking; but if a future manual TestFlight upload becomes necessary, the key still needs to be set up.

- **All other carry-overs from `[[00-NOW]]` unchanged.** Workplan Step 5 (Supabase email templates) still on Eric. AAA QB sandbox token still expired since 2026-04-21. 67c2 reviewer carry-overs F4–F8 still open. 5xx error redactor sweep across remaining ~80 routes still open.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `218f446` (the `brew install node` fix; the handoff vault commit will land on top of this)
- **In sync with `origin/main`:** yes
- **Uncommitted changes in tracked files:** none
- **Untracked:** `out/` (gitignored — cap-sync regeneration target)
- **Migrations applied this session:** none
- **Deployed to Vercel:** auto-deploy on each push triggered, no behavior change (iOS-only files + package.json deps); both deploys SUCCESS by inference (no rollback signals from Eric)
- **Distributed to TestFlight:** Build 90 archived green via Xcode Cloud — TestFlight delivery depends on the App Store Connect workflow's Distribution step (not investigated this session; Eric reported "green" which means the archive succeeded, distribution may or may not have run)
- **`build-65b-session-a` branch state:** unchanged on origin, HEAD `6362edd`, 4 commits on top of `3d5c222` (last touched 2026-04-29)

## Notes for next session

- **Diagnostic shortcut that worked twice:** Xcode Cloud build emails contain the verbatim error in two places — "Configuration Issues" (xcodebuild's view) and "Custom Scripts" (the script-runner's view). When both appear, **read the Custom Scripts section first** — it's the upstream cause; the Configuration Issues are the cascade. Build 89's `exit 127` in Custom Scripts was the upstream; the SPM resolution errors in Configuration Issues were downstream of `node_modules/` being empty.

- **`set -ex` discipline.** Worth keeping the `-x` in the script permanently, even though it makes successful runs slightly noisier. The failure-mode payoff (verbatim line-by-line output) outweighs the cost.

- **Confirmed: cap sync 8 leaves a properly-declared Package.swift alone.** When the npm declarations match what's already in Package.swift, `npx cap sync ios` regenerates Package.swift to byte-identical content (git status shows no modification). Confirms the npm-side declaration is the actual contract; the Package.swift entries are derived. This is the inverse of the build-3 strip-and-revert pattern.

- **Memorized for future Capacitor work:** the Xcode-Cloud-no-Node lesson saved to project memory `project_xcode_cloud_node_brew.md`. Next time anyone touches `ios/App/ci_scripts/`, check the memory first to avoid re-discovering the exit-127 trap.

- **For the merge of `build-65b-session-a`:** start by branch-checkout + `git merge main`, resolve conflicts on the branch (cleaner than merging branch into main directly), then push the resolved branch and either fast-forward `main` to it or open a PR. Conflict surfaces enumerated in "What's next" item 1.

## Links

- Build card: [[build-65b]]
- Current state: [[00-NOW]]
- Predecessor (this morning's triage that produced the punchlist): [[2026-05-08-build-65b-xcode-cloud-triage]]
- Predecessor (the strip-and-revert dance that this session's npm-declaration step prevents): [[2026-05-06-build-65a-testflight-build3]]
- Source build (camera UI scaffold + scratch Supabase): [[2026-04-29-build-65b]]
- Apple docs (Xcode Cloud custom build scripts): https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
