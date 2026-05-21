# NookleusWidgets — Xcode target setup

Issue #172 (PRD #56, slice 1) delivers the **source** for the Quick Actions
widget plus all the web-side deep-link wiring. The one thing an agent cannot
do on a non-Mac machine is create the Xcode target and configure App Store
Connect — those steps need Xcode and the Apple Developer portal. This file is
the checklist for that.

Everything in this folder (`ios/App/NookleusWidgets/`) is **inert** until the
target below exists — committing it does not change the app build.

## What's already done (in this branch)

- `NookleusWidgetsBundle.swift` — the `@main WidgetBundle`.
- `QuickActionsWidget.swift` — the Quick Actions widget (medium + large, four
  deep-link buttons).
- `Info.plist` — the extension's Info.plist (`widgetkit-extension` point).
- `NookleusWidgets.entitlements` — App Group `group.com.aaacontracting.platform`.
- `ios/App/App/Info.plist` — registers the `nookleus://` URL scheme.
- `ios/App/App/App.entitlements` — App Group on the main app target.
- Web layer: `src/lib/mobile/deep-link.ts` (parser, unit-tested) and
  `src/components/mobile/deep-link-listener.tsx` (handles Capacitor
  `appUrlOpen` and routes) — already wired into `src/app/layout.tsx`.

## 1. Create the Widget Extension target

1. Open **`ios/App/App.xcworkspace`** in Xcode (the workspace, not the
   `.xcodeproj`).
2. **File → New → Target… → iOS → Widget Extension**.
3. Product Name: **`NookleusWidgets`**. Team: the AAA Contracting team.
   - **Uncheck** "Include Live Activity".
   - **Uncheck** "Include Configuration App Intent" — Quick Actions is static.
     (The configurable Emails widget in slice #174 adds an App Intent later.)
   - "Embed in Application" → **App**.
4. Finish. Bundle id becomes **`com.aaacontracting.platform.NookleusWidgets`**.
   "Activate scheme?" — either choice is fine.

## 2. Swap in the provided source

Xcode scaffolds a sample widget into `ios/App/NookleusWidgets/`. Replace it
with the files already in this folder:

1. In the Project navigator, delete Xcode's generated sample widget file and
   its generated `NookleusWidgetsBundle.swift` ("Move to Trash"). If Xcode's
   scaffold collided with the committed files on disk (e.g. created
   `NookleusWidgetsBundle 2.swift`), keep the committed ones.
2. **Add Files to "App"…** → select `NookleusWidgetsBundle.swift` and
   `QuickActionsWidget.swift` from this folder. In the dialog, **Target
   Membership = `NookleusWidgets` only** (not the App target).
3. Confirm `Info.plist`: the target's `INFOPLIST_FILE` build setting should
   point at `NookleusWidgets/Info.plist`. The committed `Info.plist` matches
   the standard WidgetKit extension layout — keep whichever single copy the
   target references.

Build the `App` scheme — the widget target compiles as part of it.

## 3. App Group capability (both targets)

The Quick Actions widget needs **no** data, but the App Group is the
foundation slices #173/#174 build on, so wire it now.

1. **App** target → **Signing & Capabilities → + Capability → App Groups** →
   add **`group.com.aaacontracting.platform`**.
2. **NookleusWidgets** target → same → add the **same** group.
3. Xcode either uses the committed `.entitlements` files (`App/App.entitlements`,
   `NookleusWidgets/NookleusWidgets.entitlements`) or creates its own. Either
   way the group id must be exactly `group.com.aaacontracting.platform`. If
   Xcode created fresh entitlements files, the committed ones are redundant —
   delete whichever copy is not referenced by `CODE_SIGN_ENTITLEMENTS`.

## 4. App Store Connect / Developer portal

In the Apple Developer portal (Certificates, Identifiers & Profiles):

1. **Identifiers → App Groups**: register `group.com.aaacontracting.platform`
   if it does not already exist.
2. **Identifiers → App IDs**: register `com.aaacontracting.platform.NookleusWidgets`.
   Enable the **App Groups** capability on it and on the existing
   `com.aaacontracting.platform` App ID; assign the group to both.
3. Signing: with automatic signing, Xcode provisions both targets once the
   App IDs + capability exist. With manual signing, create/download a
   provisioning profile for the new extension App ID.

## 5. Xcode Cloud

No new workflow is required. The widget extension is **embedded in the App
target**, so the existing Default workflow (set up in #143/#147) archives it
together with the app on every push to `main`. Just confirm:

- The `App` scheme builds the `NookleusWidgets` target (it does once embedded).
- Xcode Cloud's signing has assets for the new `…NookleusWidgets` bundle id —
  automatic if Xcode Cloud manages signing; otherwise upload the profile.

## 6. Verify (deferred to slice #175)

Real-device verification — adding the widget to the home screen in medium and
large, tapping each of the four buttons, confirming the deep links land on the
right screen — is the TestFlight slice **#175**. Acceptance criteria 1–3 of
#172 are confirmed there. AC#4 (the deep-link parser) is already covered by
`src/lib/mobile/deep-link.test.ts`.
