# NookleusWidgets — Xcode target setup

Issue #172 (PRD #56, slice 1) delivers the Quick Actions widget. The Xcode
target, source wiring, and App Group entitlements were created on a Mac
(2026-05-21, Xcode 26.4) with the `xcodeproj` Ruby gem and verified with a
simulator build.

⚠️ **One step remains and it needs a human: registering the new App ID and
App Group in the Apple Developer portal (§4). Do NOT push `main` until that
is done — a signed Xcode Cloud build fails without it. See §4.**

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

## Slice 3 (#174) — Emails widget — needs one Xcode step

Slice 3 adds the data-backed **Emails** widget. It reads the per-account
snapshot the slice 2 (#173) cache pipeline writes into the App Group; the
extension still does no networking and no auth.

**New file — must be added to the `NookleusWidgets` target's Sources:**

- `NookleusWidgets/EmailsWidget.swift` — the Codable snapshot model, the App
  Group reader, the per-mailbox configuration intent, the timeline provider,
  the SwiftUI views, and the `EmailsWidget`.

In Xcode: select `EmailsWidget.swift` → File inspector → **Target
Membership** → check **`NookleusWidgets`** (the same Sources phase that
already holds `QuickActionsWidget.swift`). No other target.

`NookleusWidgetsBundle.swift` was edited in this commit to register
`EmailsWidget()` — no Xcode action, it rebuilds with the target.

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

## 4. Apple Developer portal — REMAINING, needs you

⚠️ **Do not push `main` until this is done.** The commit wires
`CODE_SIGN_ENTITLEMENTS` with an App Group. A push triggers an Xcode Cloud
build, and a signed build **fails** until the App Group and the new
extension App ID exist in the portal.

In the Apple Developer portal (Certificates, Identifiers & Profiles):

1. **Identifiers → App Groups**: register `group.com.aaacontracting.platform`
   if it does not already exist.
2. **Identifiers → App IDs**: register
   `com.aaacontracting.platform.NookleusWidgets`. Enable the **App Groups**
   capability on it and on the existing `com.aaacontracting.platform` App ID;
   assign the group to both.
3. Signing: with automatic signing, Xcode provisions both targets once the
   App IDs + capability exist. Opening the project in Xcode, the
   Signing & Capabilities tab for each target should then resolve cleanly.

Once §4 is done, push `main` — the Xcode Cloud build archives the app with
the embedded widget.

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
