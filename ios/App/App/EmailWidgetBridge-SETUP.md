# EmailWidgetBridge — Xcode setup

Issue #173 (PRD #56, slice 2) delivers the **email-summary cache pipeline**:
the web app shapes a per-account email summary and the native shell writes it
into the App Group container the Emails widget (slice 3, #174) will read.

The web layer ships and runs on the next deploy. One native step remains and
it needs a Mac with Xcode — this repo was authored on Windows, so the Swift
was written but **not compiled** (same constraint as #172).

## Delivered in this commit

**Web layer (TDD'd, live on the next deploy):**

- `src/lib/mobile/email-summary.ts` — `shapeEmailSummary`, the pure
  inbox-data → per-account-snapshot function. 9 unit tests in
  `email-summary.test.ts` (issue #173 AC#4).
- `src/lib/mobile/email-widget-bridge.ts` — the `EmailWidgetBridge` Capacitor
  plugin interface + `publishEmailSummary` (no-op off-native).
- `src/lib/mobile/use-email-summary-cache.ts` — `useEmailSummaryCache`, the
  web summary producer hook.
- `src/components/email-inbox.tsx` — calls the hook once the inbox loads.

**iOS native source (written, NOT compiled — no Xcode on Windows):**

- `ios/App/App/EmailWidgetBridgePlugin.swift` — the Swift Capacitor plugin.

## Remaining — needs Xcode

Add `EmailWidgetBridgePlugin.swift` to the **`App` target's Compile Sources**:

1. Open `ios/App/App.xcodeproj` in Xcode (SPM-based Capacitor project — there
   is no `.xcworkspace`).
2. In the Project navigator, drag `App/EmailWidgetBridgePlugin.swift` into the
   `App` group if it is not already shown.
3. Select the file → File inspector → **Target Membership** → check **`App`**.
4. Build the `App` scheme. The plugin registers itself at runtime via
   `CAPBridgedPlugin` — no Objective-C `.m` macro file and no `Podfile` entry
   are needed.

No new entitlement work: the **App Group `group.com.aaacontracting.platform`**
was already wired onto the `App` target in #172 (`App/App.entitlements`,
`CODE_SIGN_ENTITLEMENTS`), so `UserDefaults(suiteName:)` resolves once the
plugin file compiles into the target.

## The cache contract

The widget extension (slice #174) reads the summary from:

- **App Group:** `group.com.aaacontracting.platform`
- **`UserDefaults` key:** `emailSummary`
- **Value:** a JSON string of `EmailSummarySnapshot` (see
  `src/lib/mobile/email-summary.ts` for the schema — `generatedAt` plus an
  `accounts` map keyed by account id, each entry carrying `unreadCount`, up to
  three `previews`, and `updatedAt`).

## Verify (slice #175)

The plugin call path — app foreground → `writeEmailSummary` → App Group →
`reloadWidgets` → widget renders — is verified on a real device in the
TestFlight slice **#175**, alongside the Emails widget UI (#174). AC#4 (the
pure `shapeEmailSummary` function) is already covered by
`src/lib/mobile/email-summary.test.ts`.
