---
date: 2026-05-21
build_id: 172
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-172-quick-actions-widget]]"]
---

# Build 172 Handoff — 2026-05-21

## What shipped this session

Issue [#172](https://github.com/ericdaniels22/Nookleus/issues/172)'s **native half** — the part the forty-seventh session (Windows, no Xcode) explicitly deferred. Done here on a Mac with **Xcode 26.4**. One work commit `6537b29`, merged to `main` via [PR #177](https://github.com/ericdaniels22/Nookleus/pull/177) (`e09eeed`); 2 files, +235/−87.

**Xcode target (`6537b29`):**

- **`NookleusWidgets` WidgetKit app-extension target** added to `ios/App/App.xcodeproj` — created **programmatically** with the `xcodeproj` Ruby gem (1.27.0, `gem install --user-install` on system Ruby 2.6), **not** a hand-edit of `project.pbxproj`. The user chose this via `AskUserQuestion` ("I do it programmatically"). Type `com.apple.product-type.app-extension`, embedded in the `App` target via an "Embed Foundation Extensions" copy-files phase + a `PBXTargetDependency`.
- `NookleusWidgetsBundle.swift` + `QuickActionsWidget.swift` wired into the target's Sources phase; `Info.plist` set as `INFOPLIST_FILE`; bundle id `com.aaacontracting.platform.NookleusWidgets`, iOS 15.0 deployment target, automatic signing, team `QFTG9NJB7G`.
- **App Group `group.com.aaacontracting.platform`** wired on **both** targets via `CODE_SIGN_ENTITLEMENTS` (App → `App/App.entitlements`, widget → `NookleusWidgets/NookleusWidgets.entitlements`).
- A stale `Foundation.framework` reference the gem auto-adds (hardcoded `iPhoneOS18.0.sdk` path) was stripped — Swift autolinks Foundation.
- `ios/App/NookleusWidgets/SETUP.md` rewritten to reflect the done state and drop the stale "open `App.xcworkspace`" instruction.

**Verified:** `xcodebuild` builds the `App` scheme for the iOS Simulator with `NookleusWidgets.appex` embedded in `App.app/PlugIns/` and passing `ValidateEmbeddedBinary` (`CODE_SIGNING_ALLOWED=NO`). The slice-1 Swift now genuinely compiles — it was written blind on Windows.

**Apple Developer portal (done via browser, after the user signed in — NOT in git, account state):**

- App Group `group.com.aaacontracting.platform` — **registered** (none existed before).
- App ID `com.aaacontracting.platform.NookleusWidgets` ("Nookleus Widgets") — **registered**, App Groups capability enabled, the group assigned.
- Existing App ID `com.aaacontracting.platform` ("XC com aaacontracting platform", Xcode-created) — App Groups capability **enabled**, the group assigned.

## What's next

- **Watch the Xcode Cloud build** triggered by the PR #177 merge to `main` — the first build to include the widget extension + App Groups. It regenerates the main app's provisioning profile (the App Groups capability invalidated the old one) and signs/embeds `NookleusWidgets.appex`. ~10–15 min to TestFlight. This is the real proof the native target signs in the cloud.
- **Slice [#175](https://github.com/ericdaniels22/Nookleus/issues/175)** — on-device verification of #172 AC#1–3 (widget on the home screen in medium + large, the four buttons deep-link, signed-out render). The last slice of PRD #56.
- Then slices **[#173](https://github.com/ericdaniels22/Nookleus/issues/173)** (email-summary cache pipeline) → **[#174](https://github.com/ericdaniels22/Nookleus/issues/174)** (Emails widget UI) in dependency order.
- **#172 stays OPEN** by design — PR #177 carries no `Closes` keyword; AC#1–3 verify in #175. Close #172 when the implementation is accepted, or leave it paired with #175.

## Decisions locked

- **Target creation done programmatically** — user `AskUserQuestion`: "I do it programmatically." Used the `xcodeproj` gem, not a hand-edit, verified with a simulator build.
- **Commit landed on a new branch + PR** — user chose "Commit to a new branch" over committing to `main` locally; PR #177 then merged with `--merge --delete-branch` on the user's "merge PR" instruction.
- **PR #177 does not close #172** — AC#1–3 verify on-device in #175.

## Open threads

- **The Xcode Cloud build from the #177 merge is unverified** — queued at session end, not yet observed. If it fails, the likely cause is signing (the regenerated profile) — but the identifiers are all registered, so it should succeed. Real native validation is #175's TestFlight build.
- **The Swift was compiled but never run** — simulator build only, `CODE_SIGNING_ALLOWED=NO`. The widget has never rendered on a device or in the widget gallery. That is #175.
- The main app's provisioning profile was invalidated by adding the App Groups capability — Xcode Cloud's managed signing regenerates it automatically; benign, but worth noting if the first build behaves oddly.

## Mechanical state

- **Branch:** `main`.
- **Commit at session end:** `e09eeed` (`Merge pull request #177 from ericdaniels22/172-nookleus-widgets-target`).
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none — #172 is iOS/native, no DB.
- **Deployed to Vercel:** yes — the #177 merge auto-deploys `main`, but it is a **no-op for the web app** (only `project.pbxproj` + `SETUP.md` changed).

## Notes for next session

- **The `xcodeproj` gem is now installed** (user-install, system Ruby 2.6) on this Mac — future Xcode-project edits can script `project.pbxproj` rather than hand-edit. The two scripts used this session live in `/tmp` (`add_widget_target.rb`, `clean_frameworks.rb`) — not committed; regenerate if needed.
- **There is no `App.xcworkspace`** — this is an SPM-based Capacitor project; open `ios/App/App.xcodeproj` directly. SETUP.md's old instruction was wrong and is now fixed.
- **No shared schemes in the repo** (`App.xcodeproj/xcshareddata/` has none) — Xcode auto-creates the `App` and `NookleusWidgets` schemes. Xcode Cloud's `App` scheme builds the widget as a dependency, so no scheme work was needed.
- The Apple Developer portal work is **not in git** — it is account state under developer.apple.com → Certificates, Identifiers & Profiles. If the App Group or App IDs ever need re-checking, that is where they are.
- `ios/App/NookleusWidgets/SETUP.md` remains the canonical native-setup doc; §4 (portal) is now done, but the file still documents the steps for reference.

## Links

- Build card: [[build-172]]
- Current state: [[00-NOW]]
- Issue: [#172](https://github.com/ericdaniels22/Nookleus/issues/172)
- PR: [#177](https://github.com/ericdaniels22/Nookleus/pull/177)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Prior #172 handoff: [[2026-05-21-172-quick-actions-widget]]
- Related: [[2026-05-21-56-iphone-widgets-prd-and-slices]]
