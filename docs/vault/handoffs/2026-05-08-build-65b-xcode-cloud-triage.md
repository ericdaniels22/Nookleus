---
date: 2026-05-08
build_id: build-65b-xcode-cloud-triage
session_type: focused
machine: TheLaunchPad
related: ["[[build-65b]]", "[[2026-04-29-build-65b]]", "[[2026-05-06-build-65a-testflight-build3]]", "[[2026-05-08-nookleus-platform-chrome]]"]
---

# Build 65b Xcode Cloud Triage Handoff — 2026-05-08

## What shipped this session

**Pure diagnostic / triage session — zero commits, zero code changes.** Eric flagged that App Store Connect was emailing "App -- Build NN failed (main)" on every commit (Builds 79, 80, 81+ visible in inbox) and asked to tackle it. Diagnosis:

- **Root cause identified from the email body verbatim:** `xcodebuild: error: Could not resolve package dependencies: the package at '/Volumes/workspace/repository/node_modules/@capacitor/filesystem' cannot be accessed (.../node_modules/@capacitor/filesystem doesn't exist in file system)` plus identical message for `@capacitor-community/camera-preview`. Same error in the "Configuration Issues" section of the email.

- **Confirmed via codebase inspection:** `ios/App/CapApp-SPM/Package.swift:14-16` references both plugins via local `../../../node_modules/...` paths. Neither plugin is declared in `package.json` (greppe`d the deps + devDeps blocks). Local `node_modules/@capacitor/` only contains `cli`, `core`, `ios` — no `filesystem`. `node_modules/@capacitor-community/` does not exist locally at all. Zero source-code consumers in `src/` (grepped for `@capacitor/filesystem`, `@capacitor-community/camera-preview`, `Filesystem`, `CameraPreview` — all empty).

- **Connected to existing thread:** the offending entries were added to `Package.swift` in commit `b388106 ios: add camera-preview + filesystem SPM packages, drop stale out/index.html` (2026-05-06, Eric's authored commit, prior Claude session). The 2026-05-06-build-65a-testflight-build3 handoff at lines 18 + 30 + 79 explicitly flagged the same gap and queued the fix as the **first step of resuming build 65b** — *"Before any cap sync work for 65b: `npm install --save @capacitor-community/camera-preview @capacitor/filesystem`."* That step was never done; meanwhile Xcode Cloud auto-builds every push, so it's been silently failing on every commit since May 6 (the most recent Nookleus rebrand commits + 15h-followups + merge-field-pills all triggered fresh failures because the merges were direct-to-main).

- **Important non-correlation:** Vanessa's MacBook archive flow ([[2026-05-06-build-65a-testflight-build3]]) **does not** hit this bug because `npm install` is run locally before `npx cap sync ios`. The strip-and-revert dance documented in that handoff handled it. Xcode Cloud is the differentiator — it checks out the repo and goes straight to `xcodebuild` with no JS-toolchain steps. Web/Vercel is unaffected (doesn't read Package.swift). The TestFlight Capacitor app on Eric's iPad is unaffected (loads live `aaaplatform.vercel.app` per `capacitor.config.ts:9`).

- **Decision held this session: option B (finish the install) over option A (drop the unused plugins).** Eric: "lets try to finish the install. I put that build off to the side but i would like to continue." Confirmed alignment: this is build-65b proper resuming, not a one-off Xcode Cloud patch.

- **Punchlist produced for the next (Mac) session** (see "What's next").

## What's next

Eric is moving to a fresh session **on Mac** to execute the punchlist. Mac-specific because steps 2 (`npx cap sync ios`) + the inevitable iOS smoke verify both want a Mac toolchain.

**The punchlist (tightly scoped — single feature commit, ~one push):**

1. `npm install --save @capacitor-community/camera-preview @capacitor/filesystem` on `main`. Both belong in `dependencies` (not `devDependencies`) because they're runtime-shipped to iOS via the Swift Package local-path mechanism.
2. `npx cap sync ios` and **verify** `ios/App/CapApp-SPM/Package.swift` retains both `.package(...)` entries at lines 14-16 + the matching `.product(...)` entries at lines 23-25. The whole point of step 1 is that cap sync should now LEAVE these in place instead of stripping them as it did during build 3.
3. Add `ios/App/ci_scripts/ci_post_clone.sh` (executable, `chmod +x`) so Xcode Cloud has `node_modules` to read from. Minimum content:
   ```sh
   #!/bin/sh
   set -e
   cd "$CI_PRIMARY_REPOSITORY_PATH"
   npm ci
   npx cap sync ios
   ```
   Apple's Xcode Cloud convention is to look in `ci_scripts/` at the repo root OR alongside the `.xcodeproj`. The `.xcodeproj` lives at `ios/App/App.xcodeproj`, so `ios/App/ci_scripts/` is the canonical location. Apple docs: `https://developer.apple.com/documentation/xcode/writing-custom-build-scripts`. Verify Xcode Cloud is configured to run with Node available — current default Xcode Cloud images include Node, but if `npm` is missing add `brew install node` as a first line (rare, only needed on minimal images).
4. Add to `ios/App/App/Info.plist` on `main`:
   - `NSCameraUsageDescription` — string like *"Nookleus uses the camera to capture job-site photos that are saved with each job."*
   - `NSPhotoLibraryUsageDescription` — *"Nookleus uses the photo library to attach existing photos to jobs."*
   - `NSPhotoLibraryAddUsageDescription` — *"Nookleus saves captured photos to your photo library."*
   - **Important precedent**: the `build-65b-session-a` branch already added `NSCameraUsageDescription` + `NSMicrophoneUsageDescription` to its copy of Info.plist (per [[2026-04-29-build-65b]] § "Session A"). When the branch eventually merges to main, both edits will need to converge — adding usage descriptions to main now and on the branch later means the branch merge will conflict. **Two cleaner options**: (a) cherry-pick or rebase the branch's Info.plist edits into the same main commit so the branch and main agree (preferable if the branch's strings match what we want); (b) merge `build-65b-session-a` to main first via a real branch merge before this commit, then add only the missing photo-library entries on main. Option (a) is the one-commit path; option (b) is correct hygiene but couples this work to the (still incomplete) iPhone real-device verification. Recommend (a).
5. Verify locally: `npx tsc --noEmit` clean; `npm run build` ✓; commit + push.
6. **Watch the next Xcode Cloud build email.** First post-push build should show green archive. If it still fails, the most likely missing piece is the `ci_post_clone.sh` location — Apple's docs are picky about whether it lives at repo-root `ci_scripts/` vs `ios/App/ci_scripts/`. Try the other location if the first fails.

**After Xcode Cloud is green, the broader build-65b work that's still unfinished:**

- **Merge `build-65b-session-a` → main.** Branch has 4 commits on top of `3d5c222` (`7738e8a`, `f244727`, `874a542`, `6362edd`) — see [[2026-04-29-build-65b]] for the full inventory: `<CameraView>` + `<ReviewScreen>` + `<CaptureFab>` + Capacitor-only `(mobile)/jobs/[id]/capture/` route + `src/lib/mobile/` storage helpers + scratch Supabase project setup. Branch hasn't been touched since 2026-04-29 — likely needs a `git merge main` resolution given main has moved through 15d → 67c1 → 67c2 → 67d → 15e → 15f → 15g → 15h → 67e/67f → 65a-testflight-build3 → nookleus-rebrand → 15h-followups → merge-field-pills. Not all of those will conflict, but `src/components/job-detail.tsx` (where CaptureFab was wired) has churned and `package.json` definitely diverged.

- **§5.2.A iPhone real-device verification.** [[2026-04-29-build-65b]] § "What's next" enumerates the steps: iMessage `.env.scratch.local` to Mac, `git pull`, `npm install`, `npx dotenv -e .env.scratch.local -- npm run dev`, sign in as `eric+scratch@aaacontracting.com`, `npx cap sync ios`, `npx cap open ios`, install on iPhone via USB, run the 20 rapid + 5 tag-after smoke (delete 3, Done; confirm 22 .jpg + 22 .json under `pending-uploads/...`), battery-drain check after a 100-shot rapid session, permission-denied recovery flow.

- **Refreshed TestFlight upload from Mac** so iPhone Home Screen shows "Nookleus" — long-standing 65a follow-up.

- Still deferred per [[2026-04-29-build-65b]]: EXIF read for width/height/orientation (Session A scaffold writes `0/0/1` placeholders); encryption-at-rest for on-device files (locked to 65c per plan §5.3 decision 2); 65c upload-pipeline scaffolding (depends on 65b real-device verification landing first).

## Decisions locked

- **Option B (finish the install) chosen over option A (drop the plugins).** Eric explicitly said "lets try to finish the install. I put that build off to the side but i would like to continue." Reading: build-65b camera capture is genuinely on the roadmap, the May-6 unfinished step is the resume point, and dropping the SPM entries would lose the half-done work.

- **Mac session, fresh context.** Eric: "I am on mac now. But i would like to start in a fresh session." Mac access unblocks `cap sync ios` + iPhone smoke; fresh session avoids carrying this triage context into execution. Hand off here.

## Open threads

- **`build-65b-session-a` branch still on origin, untouched since 2026-04-29.** Will need a `git merge main` resolution before merge to main. The `src/components/job-detail.tsx` integration of `<CaptureFab>` is the most likely conflict surface. `package.json` diverged significantly through the 15-series and 67-series builds.

- **`out/index.html` offline-stub regeneration.** [[2026-05-06-build-65a-testflight-build3]] notes `out/` is gitignored but `cap sync` requires `out/index.html` to exist before it'll copy a stub into the iOS bundle. The May-6 session created the stub by hand. Next cap sync on Mac may need the same hand-recreate step (or step 1 of fix idea (1) from that handoff: commit a minimal `out/index.html` stub but exclude the rest of `out/*`).

- **No App Store Connect API key configured locally.** Per [[2026-05-06-build-65a-testflight-build3]] line 56-58 — `~/.appstoreconnect/private_keys/` is empty. Means CLI upload via `xcrun altool`/`xcrun notarytool` isn't available; future TestFlight uploads still need Xcode Organizer GUI. Not a blocker today (Xcode Cloud handles its own signing/upload via App Store Connect integration), but worth setting up before the next manual TestFlight upload.

- **iOS CI build failures will keep arriving until step 6 of the punchlist completes.** Eric can either ignore the emails (functionally harmless) or temporarily disable the auto-trigger on `main` in App Store Connect → Xcode Cloud → workflow settings. Re-enabling is one click after the fix lands.

- **Possible Xcode Cloud `node` availability.** Default Xcode Cloud build images ship with Node + npm but the version may lag npm 10. If `npm ci` fails on the post-clone script, brew-install Node as the first line. (See punchlist step 3.)

- **All other carry-overs from `[[00-NOW]]` unchanged.** Workplan Step 5 (Supabase email templates) still on Eric. AAA QB sandbox token still expired since 2026-04-21. 67c2 reviewer carry-overs F4–F8 still open. 5xx error redactor sweep across remaining ~80 routes still open.

## Mechanical state

- **Branch:** `main`
- **Commit at session end:** `2a5cc7a` (vault handoff for nookleus-platform-chrome — last session's commit, this session added nothing on top until the handoff write below)
- **In sync with `origin/main`:** yes
- **Uncommitted changes in tracked files:** none
- **Untracked:** `out/` (gitignored — cap-sync regeneration target)
- **Migrations applied this session:** none
- **Deployed to Vercel:** n/a — no code changes
- **Distributed to TestFlight:** n/a — Xcode Cloud builds still failing (will be addressed next session)
- **`build-65b-session-a` branch state:** unchanged on origin, HEAD `6362edd`, 4 commits on top of `3d5c222` (last touched 2026-04-29)

## Notes for next session

- **The diagnostic shortcut that worked here**: `b388106` modifies `Package.swift` only (no `package.json` touch). When you see `xcodebuild: error: Could not resolve package dependencies: the package at .../node_modules/X cannot be accessed`, the question to ask is *"is X declared in package.json?"* before assuming a missing CI step. In this case it wasn't, so the missing CI step is real but secondary; the missing npm declaration is the upstream cause.

- **Read-before-edit on `Package.swift`.** The first comment in `ios/App/CapApp-SPM/Package.swift:4` is `// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands`. The May-6 session manually edited it (commit `b388106`) and then May-6 evening's `cap sync ios` reverted those edits. The right pattern is: declare the plugin in `package.json` → `cap sync ios` regenerates Package.swift with the plugin entries automatically. Hand-editing is for emergency unblock only.

- **Xcode Cloud `ci_post_clone.sh` location nuances.** Apple's docs say: "Xcode Cloud searches for these scripts in a folder named ci_scripts at the same level as your Xcode project or workspace, OR at your repository's root level." For this repo the project is at `ios/App/App.xcodeproj`, so `ios/App/ci_scripts/ci_post_clone.sh` is canonical. If that doesn't fire, the fallback is repo-root `ci_scripts/ci_post_clone.sh`. Empirically test before assuming.

- **Step ordering matters for `cap sync` re-strip risk.** If `cap sync ios` is run BEFORE `npm install` on a fresh checkout, it will strip the unrecognized plugin entries from Package.swift. The post-clone script must do `npm ci` THEN `npx cap sync ios` in that order. Locally the same — don't run `cap sync` against a stale `node_modules`.

- **The `out/` directory hygiene fix is worth taking on this session.** Path-of-least-resistance: write a one-line npm script `prepare:ios` that touches a minimal `out/index.html` stub, then put it in `package.json`'s `scripts` block, and reference it in the Xcode Cloud post-clone script *before* `cap sync`. Eliminates a recurring fragile step and survives both fresh clones and Xcode Cloud's ephemeral workspace.

- **Memory worth saving for this session's lesson** — *"Capacitor Swift Package plugin entries must always have an npm-side declaration in `package.json` before they're added to `ios/App/CapApp-SPM/Package.swift`; hand-editing Package.swift is an anti-pattern that survives until the next `cap sync ios`."* Saving this would prevent the same trap in future Capacitor plugin add work. Will add at session-write time.

## Links

- Build card: [[build-65b]]
- Current state: [[00-NOW]]
- Predecessor (TestFlight build 3 + the strip-and-revert dance): [[2026-05-06-build-65a-testflight-build3]]
- Source build (camera UI scaffold + scratch Supabase): [[2026-04-29-build-65b]]
- Same-day prior session: [[2026-05-08-nookleus-platform-chrome]]
- Apple docs (Xcode Cloud custom build scripts): https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
