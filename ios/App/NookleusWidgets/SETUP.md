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

Real-device verification — adding the widget to the home screen in medium
and large, tapping each of the four buttons, confirming the deep links land
on the right screen — is the TestFlight slice **#175**. Acceptance criteria
1–3 of #172 are confirmed there. AC#4 (the deep-link parser) is already
covered by `src/lib/mobile/deep-link.test.ts`.
