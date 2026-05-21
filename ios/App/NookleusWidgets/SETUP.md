# NookleusWidgets — Xcode target setup

Issue #172 (PRD #56, slice 1) delivers the Quick Actions widget. The Xcode
target, source wiring, and App Group entitlements were created on a Mac
(2026-05-21, Xcode 26.4) with the `xcodeproj` Ruby gem and verified with a
simulator build.

✅ **Apple Developer portal setup (§4) is complete** — the App Group and the
`…NookleusWidgets` App ID were registered on 2026-05-21 (#172 native half).
`main` has shipped signed Xcode Cloud builds since; no portal blocker remains.

## Done — Xcode project (in this commit)

- **`NookleusWidgets` WidgetKit app-extension target** added to
  `App.xcodeproj` (`com.apple.product-type.app-extension`), embedded in the
  `App` target via an "Embed Foundation Extensions" copy-files phase plus a
  target dependency.
- `NookleusWidgetsBundle.swift` + `QuickActionsWidget.swift` wired into the
  target's Sources phase; `Info.plist` set as `INFOPLIST_FILE`.
- Bundle id `com.aaacontracting.platform.NookleusWidgets`, deployment target
  iOS 15.0, automatic signing, team `QFTG9NJB7G`.
- **App Group wired on both targets** via `CODE_SIGN_ENTITLEMENTS`:
  - App → `App/App.entitlements`
  - NookleusWidgets → `NookleusWidgets/NookleusWidgets.entitlements`
  - both carry `group.com.aaacontracting.platform`.
- Verified: `xcodebuild` builds the `App` scheme for the iOS Simulator with
  `NookleusWidgets.appex` embedded in `App.app/PlugIns/`
  (`CODE_SIGNING_ALLOWED=NO` — the Swift compiles and the project structure
  is valid without provisioning).

Note: this is an SPM-based Capacitor project — there is **no
`App.xcworkspace`**. Open `ios/App/App.xcodeproj` directly in Xcode.

## Web layer (shipped — slice 1 web half)

- `src/lib/mobile/deep-link.ts` (parser, unit-tested) and
  `src/components/mobile/deep-link-listener.tsx` — wired into `src/app/layout.tsx`.

## Slice 3 (#174) — Emails widget — Xcode wiring done

Slice 3 adds the data-backed **Emails** widget. It reads the per-account
snapshot the slice 2 (#173) cache pipeline writes into the App Group; the
extension still does no networking and no auth.

- `NookleusWidgets/EmailsWidget.swift` — the Codable snapshot model, the App
  Group reader, the per-mailbox configuration intent, the timeline provider,
  the SwiftUI views, and the `EmailsWidget`.

**Done (2026-05-21, Xcode 26.4.1):** `EmailsWidget.swift` was added to the
`NookleusWidgets` target's Compile Sources phase — the same phase that holds
`QuickActionsWidget.swift`. Done programmatically with the `xcodeproj` Ruby
gem (not a hand-edit of `project.pbxproj`), mirroring #172/#173.
`NookleusWidgetsBundle.swift` (committed with the #174 web PR) already
registers `EmailsWidget()` behind `if #available(iOS 17.0, *)` — no Xcode
action, it rebuilds with the target.

**Verified:** `xcodebuild` builds the **`App` scheme** for the iOS Simulator
(`CODE_SIGNING_ALLOWED=NO`) — `** BUILD SUCCEEDED **`, `EmailsWidget.swift`
compiled into `NookleusWidgets` (arm64 + x86_64), AppIntents metadata
extracted, `NookleusWidgets.appex` embedded in `App.app/PlugIns/` and passing
`ValidateEmbeddedBinary`, 0 errors / 0 warnings. Build the **`App` scheme**,
not `-target App` — a bare `-target` build fails to order the SPM package
graph (`SwiftKeychainWrapper`).

**iOS 17+ for the Emails widget — decision to ratify.** Per-instance
configuration uses `AppIntentConfiguration` + `WidgetConfigurationIntent`
(the AppIntents framework), not a legacy SiriKit `.intentdefinition` file.
That keeps the configuration pure Swift with no generated-intent code, at the
cost of the Emails widget requiring **iOS 17+**. The extension's deployment
target stays **iOS 15** — `NookleusWidgetsBundle` gates the Emails widget
behind `if #available(iOS 17.0, *)`, so Quick Actions still ships to iOS 15/16
and the Emails widget simply does not appear in the gallery below iOS 17. No
deployment-target change is needed. If iOS 15/16 support for the Emails
widget is required, this must be reworked to `IntentConfiguration` with a
SiriKit custom intent.

**Web layer (slice 3 half, TDD'd, live on the next deploy):**

- `src/lib/mobile/deep-link.ts` — `parseDeepLink` now handles
  `nookleus://email?account=<id>` → `/email?account=<id>` and
  `nookleus://email?id=<id>` → `/email?id=<id>` (bare `nookleus://email` →
  `/email`).
- `src/lib/mobile/email-summary.ts` — `EmailSummaryPreview` gained an `id`
  field (the email id), so a preview tap can deep-link to that exact email.
  The Swift `EmailSummaryPreview` in `EmailsWidget.swift` mirrors it.
- `src/components/email-inbox.tsx` — consumes the `account` and `id` query
  params on mount (selects the account / opens the email).

## 4. Apple Developer portal — DONE (2026-05-21, #172 native half)

The entitlements wiring (`CODE_SIGN_ENTITLEMENTS` + App Group) needed portal
registration before a signed Xcode Cloud build could succeed. That was
completed when the #172 native half landed:

1. **App Group** `group.com.aaacontracting.platform` — registered.
2. **App ID** `com.aaacontracting.platform.NookleusWidgets` — registered with
   the **App Groups** capability; the same capability + group were also added
   to the existing `com.aaacontracting.platform` App ID.
3. Signing — automatic; Xcode Cloud's managed signing provisions both
   targets. Signed builds have shipped to TestFlight since.

No portal action remains for the Emails widget — `EmailsWidget.swift` is a
source file on an existing target, with no new entitlement or App ID.

## 5. Xcode Cloud

No new workflow is required. The widget extension is embedded in the `App`
target, so the existing Default workflow (#143/#147) archives it together
with the app, and the `App` scheme builds `NookleusWidgets` as a dependency.
Just confirm Xcode Cloud's signing has assets for the new
`…NookleusWidgets` bundle id — automatic if Xcode Cloud manages signing,
otherwise upload the profile created in §4.

## 6. Verify (slice #175)

Real-device verification is the TestFlight slice **#175**:

- **Quick Actions (#172)** — add it in medium and large, tap each of the four
  buttons, confirm the deep links land on the right screen (#172 AC#1–3).
- **Emails (#174)** — add it in medium and large; configure each instance to
  a mailbox via the widget's edit screen; confirm the unread count + previews
  render, the "Updated Xh ago" line is present, the "Open the app to sync"
  empty state shows with no cache, and tapping a preview / the count deep-links
  correctly (#174 AC#1–6).

The pure logic is already unit-tested off-device: `deep-link.test.ts` covers
the parser (all `nookleus://` routes) and `email-summary.test.ts` covers
`shapeEmailSummary` (including the preview `id`). The SwiftUI / WidgetKit /
AppIntent code carries no automated tests — repo norm for native iOS work.
