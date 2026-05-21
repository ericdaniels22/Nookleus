---
date: 2026-05-21
build_id: 173
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-173-email-summary-cache-pipeline]]", "[[2026-05-21-172-xcode-target-and-portal]]"]
---

# Build 173 Handoff — 2026-05-21

## What shipped this session

Issue [#173](https://github.com/ericdaniels22/Nookleus/issues/173)'s **one remaining native step** — the part the forty-ninth session (Windows, no Xcode) explicitly deferred. Done here on a Mac with **Xcode 26.4.1**. One work commit `7833580`, merged to `main` via [PR #180](https://github.com/ericdaniels22/Nookleus/pull/180) (`9d7ac6c`); 2 files, +23/−14.

**Xcode wiring (`7833580`):**

- **`EmailWidgetBridgePlugin.swift` added to the `App` target's Compile Sources phase** in `ios/App/App.xcodeproj`. Done **programmatically** with the `xcodeproj` Ruby gem (1.27.0 — already installed on this Mac from #172), **not** a hand-edit of `project.pbxproj`: a `PBXFileReference` + `PBXBuildFile`, wired into the `App` group and the `App` target's `Sources` build phase (`project.pbxproj` +4 lines).
- `ios/App/App/EmailWidgetBridge-SETUP.md` updated from a "Remaining — needs Xcode" instruction list to a "Xcode wiring — done" state, including the `-scheme` build gotcha below.

**Verified:** `xcodebuild` builds the **`App` scheme** for the iOS Simulator (`CODE_SIGNING_ALLOWED=NO`) — `** BUILD SUCCEEDED **`, `EmailWidgetBridgePlugin.swift` compiled into the `App` target (arm64 + x86_64), **0 errors / 0 warnings**, `App.app` produced with `PlugIns/NookleusWidgets.appex` embedded. The #173 Swift, written blind on Windows, now genuinely compiles into the app target.

## What's next

- **Watch the Xcode Cloud build** triggered by the PR #180 merge to `main` — the first build to compile `EmailWidgetBridgePlugin.swift` into the `App` target. ~10–15 min to TestFlight.
- **Slice [#174](https://github.com/ericdaniels22/Nookleus/issues/174)** — Emails widget UI + per-account configuration — **merged concurrently** via [PR #179](https://github.com/ericdaniels22/Nookleus/pull/179) while this session ran. Its own Mac Xcode step (`EmailsWidget.swift` → `NookleusWidgets` target Sources) is still pending, mirroring this session's #173 step.
- Then slice **[#175](https://github.com/ericdaniels22/Nookleus/issues/175)** — TestFlight on-device verification, the last slice of PRD [#56](https://github.com/ericdaniels22/Nookleus/issues/56).
- **#173 stays OPEN** by design — PR #180 carries no `Close` keyword; the full plugin call path verifies on-device in #175 (mirrors #172/#178).

## Decisions locked

- **Xcode wiring done programmatically** — used the `xcodeproj` gem, not a hand-edit, verified with a simulator build (the #172 precedent).
- **Land via Commit + PR** — user `AskUserQuestion`: "Commit + PR (like #172)". Branch `173-email-widget-bridge-xcode`, then `gh pr merge --merge --delete-branch`.
- **PR #180 does not close #173** — on-device verification is #175.
- **Re-ran the `xcodeproj` script after the permission classifier blocked it** — user: "go ahead and run it". And **merged PR #180** — user: "merge".

## Open threads

- **The Xcode Cloud build from the #180 merge is unverified** — triggered at session end, not yet observed. Real native validation is #175's TestFlight build.
- **The Swift plugin compiled but never ran** — simulator build only, `CODE_SIGNING_ALLOWED=NO`. The call path app foreground → `writeEmailSummary` → App Group → `reloadWidgets` → widget render has never executed on a device. That is #175.

## Mechanical state

- **Branch:** `main`.
- **Commit at session end:** `9d7ac6c` (`Merge pull request #180 from ericdaniels22/173-email-widget-bridge-xcode`).
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none — #173's native step is iOS-only, no DB.
- **Deployed to Vercel:** yes — the #180 merge auto-deploys `main`, but it is a **no-op for the web app** (only `project.pbxproj` + `SETUP.md` changed).

## Notes for next session

- **Build the `App` *scheme*, not `-target App`.** The first two `xcodebuild` attempts used `-target App` and FAILED — `SecureStoragePlugin` errors with `unable to resolve module dependency: 'SwiftKeychainWrapper'` because a bare `-target` build does not order transitive SPM package dependencies. Building the **`App` scheme** processes the whole package graph and orders it. New memory `project_xcodebuild_app_scheme_not_target` records this, the working command, and that a scheme build leaves a stray `ios/App/CapApp-SPM/build/` artifact dir (deleted this session, not committed — worth a `.gitignore` entry if it recurs).
- **The `xcodeproj` gem script** lives at `/tmp/add_email_widget_bridge.rb` — not committed (same convention as #172's `/tmp` scripts); regenerate if needed.
- **The permission classifier blocked the Ruby script** on a mistaken premise — it claimed `EmailWidgetBridgePlugin.swift` didn't exist when it did (committed in #173). The user re-approved. A Bash permission rule for `ruby` would smooth future Xcode-project scripting on this Mac.
- **There is no `App.xcworkspace`** — SPM-based Capacitor project; open `ios/App/App.xcodeproj` directly. The `App` and `NookleusWidgets` schemes are autocreated by `xcodebuild`; none are checked into `xcshareddata/`.
- PRD #56 now has **three of four slices merged** (#172 Quick Actions, #173 email-summary pipeline, #174 Emails widget UI via PR #179); #174's Swift still needs its Xcode target-membership step; #175 (TestFlight) is the final slice.

## Links

- Build card: [[build-173]]
- Current state: [[00-NOW]]
- Issue: [#173](https://github.com/ericdaniels22/Nookleus/issues/173)
- PR: [#180](https://github.com/ericdaniels22/Nookleus/pull/180)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Prior #173 handoff: [[2026-05-21-173-email-summary-cache-pipeline]]
- Related: [[2026-05-21-172-xcode-target-and-portal]]
