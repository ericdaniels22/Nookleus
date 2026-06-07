# EmailWidgetBridge — Xcode setup

Issue #173 (PRD #56, slice 2) delivers the **email-summary cache pipeline**:
the web app shapes a per-account email summary and the native shell writes it
into the App Group container the Emails widget (slice 3, #174) will read.

The web layer ships and runs on the deploy. The one native step — adding the
Swift plugin to the `App` target — is now **done** (see "Xcode wiring" below);
it needed a Mac with Xcode because the file was authored on Windows.

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

## Xcode wiring — done

`EmailWidgetBridgePlugin.swift` is in the **`App` target's Compile Sources**
phase (`ios/App/App.xcodeproj/project.pbxproj`). It was added programmatically
with the `xcodeproj` Ruby gem — the same approach #172 used for the
`NookleusWidgets` target — not a hand-edit of `project.pbxproj`.

Verified: `xcodebuild` builds the **`App` scheme** for the iOS Simulator
(`CODE_SIGNING_ALLOWED=NO`) with `EmailWidgetBridgePlugin.swift` compiled into
the `App` target and `NookleusWidgets.appex` embedded.

> Build the **`App` scheme**, not `-target App`. A bare `-target` build does
> not order transitive SPM package dependencies, so `SecureStoragePlugin`
> fails with `unable to resolve module dependency: 'SwiftKeychainWrapper'`.

### Registration — manual, NOT automatic (issue #175)

The earlier claim that "the plugin registers itself at runtime via
`CAPBridgedPlugin`" was **wrong**, and it was the root cause of the Emails
widget shipping empty through build 223.

Capacitor 8 only instantiates the plugin classes listed in
`capacitor.config.json`'s `packageClassList`. That file is **gitignored**
(`ios/.gitignore`) and **regenerated** by `npx cap sync ios` — which CI runs in
`ios/App/App/ci_scripts/ci_post_clone.sh` — from the installed npm
`@capacitor/*` packages. A hand-written, non-npm Swift plugin is never added
there. Capacitor 8 also dropped the Objective-C `CAP_PLUGIN` macro scan, so
**compiling the file into the target is necessary but NOT sufficient** — the
class is never instantiated, `registerPlugin("EmailWidgetBridge")` resolves to
the no-op web proxy, and `writeEmailSummary` rejects "not implemented".

The fix is **manual registration** in a `CAPBridgeViewController` subclass that
is the storyboard's root view controller:

- `ios/App/App/MainViewController.swift` — overrides `capacitorDidLoad()` and
  calls `bridge?.registerPluginInstance(EmailWidgetBridgePlugin())`.
- `ios/App/App/Base.lproj/Main.storyboard` — the initial view controller is
  repointed from `CAPBridgeViewController`/`Capacitor` to
  `MainViewController`/`App` (`customModuleProvider="target"`).

Both files are in the `App` target's Compile Sources / resources in
`project.pbxproj`. No Objective-C `.m` macro file and no `Podfile` entry are
needed — but editing `packageClassList` directly would NOT survive the next
`cap sync`, which is why registration lives in code.

No new entitlement work: the **App Group `group.com.aaacontracting.platform`**
was already wired onto the `App` target in #172 (`App/App.entitlements`,
`CODE_SIGN_ENTITLEMENTS`), so `UserDefaults(suiteName:)` resolves now that the
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
