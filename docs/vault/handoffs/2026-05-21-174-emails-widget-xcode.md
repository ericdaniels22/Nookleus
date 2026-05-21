---
date: 2026-05-21
build_id: 174
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-174-emails-widget]]", "[[2026-05-21-173-email-widget-bridge-xcode]]"]
---

# Build 174 Handoff — 2026-05-21

## What shipped this session

Issue [#174](https://github.com/ericdaniels22/Nookleus/issues/174)'s **one
remaining native step** — the Mac Xcode work the fiftieth session (Windows, no
Xcode) deferred when it built and merged the #174 web/Swift layer via
[PR #179](https://github.com/ericdaniels22/Nookleus/pull/179). Done here on a
Mac with **Xcode 26.4.1**. One work commit `01d3a76`, merged to `main` via
[PR #181](https://github.com/ericdaniels22/Nookleus/pull/181) (`ed637cb`);
2 files, +35/−30.

**Xcode wiring (`01d3a76`):**

- **`EmailsWidget.swift` added to the `NookleusWidgets` target's Compile
  Sources phase** in `ios/App/App.xcodeproj` — the same phase that already
  holds `QuickActionsWidget.swift`. Done **programmatically** with the
  `xcodeproj` Ruby gem (1.27.0 — installed on this Mac since #172), **not** a
  hand-edit of `project.pbxproj`: a `PBXFileReference` + `PBXBuildFile`, wired
  into the `NookleusWidgets` group and the target's `Sources` build phase
  (`project.pbxproj` +4 lines).
- `NookleusWidgetsBundle.swift` (committed with PR #179) already registers
  `EmailsWidget()` behind `if #available(iOS 17.0, *)` — no Xcode action
  needed; it rebuilds with the target.
- `ios/App/NookleusWidgets/SETUP.md` updated: the "Slice 3 (#174) — needs one
  Xcode step" section flipped to a "Xcode wiring done" state, and the stale §4
  portal warning ("Do NOT push `main` until the App ID/App Group is
  registered") refreshed — that registration completed back with the #172
  native half (forty-eighth session).

**Verified:** `xcodebuild` builds the **`App` scheme** for the iOS Simulator
(`CODE_SIGNING_ALLOWED=NO`) — `** BUILD SUCCEEDED **`, `EmailsWidget.swift`
compiled into the `NookleusWidgets` target (arm64 + x86_64), AppIntents
metadata extracted (the `AppIntentConfiguration` / `WidgetConfigurationIntent`
per-mailbox config compiles), `NookleusWidgets.appex` produced + embedded in
`App.app/PlugIns/` and passing `ValidateEmbeddedBinary`, **0 errors /
0 warnings**. A forced recompile of `EmailsWidget.swift` re-confirmed 0/0. The
#174 Swift, written blind on Windows, now genuinely compiles into the widget
extension.

## What's next

- **Xcode Cloud build of the #181 merge — done; see the post-handoff addendum.**
  Net: the widget code is already on TestFlight **build 223** (`Complete`);
  build 224 failed only on Apple's daily upload limit (error 90382), not a code
  bug. The upload quota resets ~24h after the failure.
- **Slice [#175](https://github.com/ericdaniels22/Nookleus/issues/175)** —
  TestFlight on-device verification — is now the **single remaining slice** of
  PRD [#56](https://github.com/ericdaniels22/Nookleus/issues/56). All three
  widget code slices (#172 Quick Actions, #173 email-summary pipeline, #174
  Emails widget) are wired into the app and compile; #175 closes the PRD.
- **#174 stays OPEN** by design — PR #181 carries no `Close` keyword; the full
  Emails-widget path verifies on-device in #175 (mirrors #172/#173).

## Decisions locked

- **Land via Commit + PR** — user `AskUserQuestion`: "Commit + PR (like
  #172/#173)". Branch `174-emails-widget-xcode`, then `gh pr merge --merge
  --delete-branch`.
- **PR #181 does not close #174** — on-device verification is #175.
- **Merged PR #181** — user: "merge".

## Open threads

- **The Xcode Cloud build from the #181 merge — resolved post-handoff.** Build
  224 (`944aa43`) failed on Apple error 90382 (daily upload limit), but build
  223 (`ed637cb`, the #181 merge) is `Complete` and already carries the widget
  code. See the post-handoff addendum.
- **The Emails widget compiled but never ran** — simulator build only,
  `CODE_SIGNING_ALLOWED=NO`. The path app foreground → cache write →
  `NookleusWidgets` reads the App Group → per-mailbox config picker → render →
  deep-link taps has never executed on a device. That is #175.

## Mechanical state

- **Branch:** `main`.
- **Commit at session end:** `ed637cb` (`Merge pull request #181 from
  ericdaniels22/174-emails-widget-xcode`).
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none — #174's native step is iOS-only,
  no DB.
- **Deployed to Vercel:** yes — the #181 merge auto-deploys `main`, but it is a
  **no-op for the web app** (only `project.pbxproj` + `SETUP.md` changed).

## Notes for next session

- **Build the `App` *scheme*, not `-target App`** — per memory
  `project_xcodebuild_app_scheme_not_target`. A bare `-target` build fails to
  order transitive SPM dependencies (`SwiftKeychainWrapper`). The working
  command is in that memory; it was used verbatim this session. No stray
  `ios/App/CapApp-SPM/build/` artifact dir appeared this run (the #173 session
  warned of it — it did not recur).
- **The `xcodeproj` gem script** lives at `/tmp/add_emails_widget.rb` — not
  committed (same `/tmp` convention as #172/#173); regenerate from this
  handoff if needed. It is idempotent (bails if the file is already wired).
- **PRD #56 is one slice from done.** #172/#173/#174 are all merged and
  compile; only #175 (TestFlight on-device verification) remains. #172, #173,
  #174 are all still OPEN issues by design — each is verified by #175.
- **`ios/App/NookleusWidgets/SETUP.md` now reflects the done state** for all of
  #172/#173/#174's Xcode work. Its §4 (Apple Developer portal) previously still
  warned "Do NOT push `main`" though that registration was completed in the
  forty-eighth session — refreshed this session.
- **The structured lower half of `00-NOW.md`** (`## Current build` onward, line
  ~257+) is stale — frozen at the forty-first session (#152). The maintained
  surface is the `last_verified:` paragraph stack at the top; this handoff
  updated only that, matching every recent session. Worth a cleanup pass.

## Post-handoff addendum — Xcode Cloud build 224 + workflow fix

Written after the handoff commit (`944aa43`), recorded here at the user's
request. Watched the Xcode Cloud build the #181 merge triggered:

- **Build 224 (`944aa43`) failed — Apple error `90382`, "Upload limit reached."**
  Not a code error: the build compiled, archived, and uploaded fine (every
  Xcode Cloud log task green); App Store Connect rejected the *upload* on the
  per-app **daily upload quota**. Today's session pushed ~9 build-triggering
  commits to `main` (builds 216→224); 224 was over the cap. The quota resets in
  ~24h; a local device Release build (`-sdk iphoneos`, signing off) is clean —
  no regression, nothing to fix in code.
- **The widget code is already on TestFlight.** Build **223** = the PR #181
  merge (`ed637cb`, carrying work commit `01d3a76`) is `Complete` / `Validated`.
  So #172/#173/#174's widget code is on a good TestFlight build — **slice #175's
  on-device verification is not blocked.**
- The earlier "build red since #173" read was **wrong** — GitHub check-run
  conclusions (`action_required` / `cancelled`) do not reflect Xcode Cloud build
  success. TestFlight showed builds 216 / 217 / 223 all `Complete`. New memory
  `project_xcode_cloud_github_status_unreliable` records this.

**Workflow change (App Store Connect setting — not in git):** the Default Xcode
Cloud workflow's *Branch Changes → Files and Folders* start condition was
changed from "Any File" to Custom Rules — **"Start a build if any file from the
`ios` folder changes."** Docs-only (`docs/vault/**`) and web-only (`src/**`)
`main` pushes no longer trigger a build + TestFlight upload — the iOS app is a
Capacitor shell loading the live Vercel URL, so non-`ios/` changes don't change
the binary. This prevents recurrence of the 90382 quota exhaustion (today's 9
builds would have been 3). Tradeoff: a commit changing `capacitor.config.ts`
(repo root) or adding a native plugin via `package.json` without touching
`ios/` won't auto-build — start such a build manually from the Xcode Cloud tab.
`package.json` was deliberately left out of the filter (it churns on web-only
dep bumps). New memory: `project_xcode_cloud_upload_limit_90382`.

## Links

- Build card: [[build-174]]
- Current state: [[00-NOW]]
- Issue: [#174](https://github.com/ericdaniels22/Nookleus/issues/174)
- PR: [#181](https://github.com/ericdaniels22/Nookleus/pull/181)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Prior #174 handoff: [[2026-05-21-174-emails-widget]]
- Related: [[2026-05-21-173-email-widget-bridge-xcode]]
