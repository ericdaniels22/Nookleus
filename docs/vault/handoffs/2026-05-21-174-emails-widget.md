---
date: 2026-05-21
build_id: 174
session_type: focused
machine: TheLaunchPad (Claude Code on Windows)
related: ["[[2026-05-21-173-email-summary-cache-pipeline]]", "[[2026-05-21-172-quick-actions-widget]]", "[[2026-05-21-56-iphone-widgets-prd-and-slices]]"]
---

# Build 174 Handoff — 2026-05-21

## What shipped this session

Issue [#174](https://github.com/ericdaniels22/Nookleus/issues/174) — **slice 3 of 4 of PRD [#56](https://github.com/ericdaniels22/Nookleus/issues/56)** (iPhone widgets), the **Emails widget UI + per-account configuration** — implemented via `/tdd` in an isolated worktree and **pushed as [PR #179](https://github.com/ericdaniels22/Nookleus/pull/179)** (still OPEN, not merged). Commit `0822ece`, 8 files, +532 / −11.

**The session ran as a watch-then-implement loop.** The user asked to start #174 automatically once #172 *and* #173 were complete, and (via `AskUserQuestion`) chose that other agents would deliver #172/#173 while this session only monitored. A `/loop` in dynamic mode polled `gh issue view 172/173` on ~30-minute `ScheduleWakeup` ticks. #172 closed first; on the tick where #173 also closed COMPLETED, the loop synced `main` to `afd4bbc` (both slices already merged via PR #177/#178), cut the worktree, and ran the build.

**Web layer (TDD'd, ships on the PR-merge deploy):**

- **`src/lib/mobile/deep-link.ts`** — `parseDeepLink` extended for the Emails widget's deep links over **3 RED→GREEN cycles**: `nookleus://email?account=<id>` → `/email?account=<id>` (tap the unread count → that account's inbox), `nookleus://email?id=<id>` → `/email?id=<id>` (tap a preview → that exact email), and a bare `nookleus://email` → `/email`. `id` takes precedence over `account` if both are present. The four #172 Quick Actions routes and `compose-email` are untouched (distinct hosts).
- **`src/lib/mobile/email-summary.ts`** — `EmailSummaryPreview` gained an **`id`** field, and `EmailSummaryEmail` now also `Pick`s `Email["id"]`; `shapeEmailSummary` maps `e.id` into each preview. **1 RED→GREEN cycle.** This closes a contract gap: #173 shipped previews as `{ sender, subject }` only, but #174 AC#6 ("tapping a preview opens *that email*") needs a routing key. `id` is not displayed, so it does not change the PRD's "sender + subject" display scope.
- **`src/components/email-inbox.tsx`** — the existing on-mount query-param effect now also consumes `account` (→ `setSelectedAccountId`) and `id` (→ `setSelectedEmailId`). `EmailReader` already fetches `/api/email/[id]` directly, so a deep-linked email resolves even when it is not in the loaded inbox page.

**iOS native source (written, NOT compiled — no Xcode on Windows):**

- **`ios/App/NookleusWidgets/EmailsWidget.swift`** (new) — the whole Emails widget in one file: the Swift `Codable` snapshot model (`EmailSummarySnapshot` / `AccountEmailSummary` / `EmailSummaryPreview`, mirroring the TS contract), `EmailSummaryStore` (App Group `UserDefaults` reader, key `emailSummary`), the per-mailbox configuration intent (`SelectMailboxIntent: WidgetConfigurationIntent` + `MailboxEntity: AppEntity` + `MailboxQuery: EntityQuery` whose picker is sourced from the cached snapshot — no networking), the `AppIntentTimelineProvider`, the SwiftUI views (header with unread badge, up to 3 preview rows, "Updated Xh ago" line, "Open the app to sync" empty state), `nookleus://` deep-link `Link`s + `widgetURL`, and the `EmailsWidget` (`AppIntentConfiguration`, medium + large).
- **`ios/App/NookleusWidgets/NookleusWidgetsBundle.swift`** — registers `EmailsWidget()` behind `if #available(iOS 17.0, *)`.
- **`ios/App/NookleusWidgets/SETUP.md`** — new "Slice 3 (#174)" section + updated §6.

**Verification:** full suite **788 passed (125 files)** — baseline 784/125, +4 tests. `tsc --noEmit` clean on the changed surface (only the pre-existing unrelated `sync-folder-incremental.test.ts` `TS2322` remains). `eslint` clean on all 5 changed web files. The Swift was **not** compiled — no Xcode on Windows.

## What's next

1. **Review + merge [PR #179](https://github.com/ericdaniels22/Nookleus/pull/179)** — a human/Mac eye on `EmailsWidget.swift` is worth it (uncompiled Swift). Merging deploys the web layer (parser, shaper, `email-inbox.tsx`).
2. **On a Mac**, follow the new section in `ios/App/NookleusWidgets/SETUP.md` — add `EmailsWidget.swift` to the `NookleusWidgets` target's Sources phase (Target Membership checkbox), then build the `App` scheme.
3. **[#175](https://github.com/ericdaniels22/Nookleus/issues/175)** (TestFlight verification) — verifies #174 AC#1–6 on a real device and **closes PRD #56**.
4. **Close #174** once the Xcode wiring lands and #175 verifies — PR #179 deliberately carries no `Closes` keyword, so the issue stays OPEN (the #172/#173 pattern).

## Decisions locked

Both confirmed by the user via `AskUserQuestion`:

- **Dependency handling = "Others do #172/#173; I monitor."** Other agents/sessions would deliver #172 and #173; this session set up a watch-loop and only auto-started #174 once both issues closed.
- **Integration = "Push + open PR."** → PR #179, worktree kept alive for review iteration. (No auto-merge — untested native Swift wants review.)

## Open threads

- **PR #179 is OPEN, unmerged** — awaiting review. No `Closes` keyword; #174 stays open until the Xcode target-membership step + #175 land.
- **Two agent decisions (NOT user-confirmed) flagged for the reviewer**, documented in the PR body and `SETUP.md`:
  - **The Emails widget is iOS 17+.** Per-instance configuration uses `AppIntentConfiguration` + `WidgetConfigurationIntent` (the AppIntents framework) instead of a legacy SiriKit `.intentdefinition` file — the latter needs Xcode-generated code that cannot be hand-authored reliably on Windows. The extension's deployment target stays iOS 15; `NookleusWidgetsBundle` gates the Emails widget behind `if #available(iOS 17.0, *)`, so Quick Actions still ships to iOS 15/16. If iOS 15/16 support for the Emails widget is required, this must be reworked to `IntentConfiguration`.
  - **`EmailSummaryPreview` was extended with `id`** — this touches the contract #173 shipped (merged in PR #178). The web `shapeEmailSummary` change is TDD-covered; the Swift side mirrors it.
- **The Swift was never compiled** — no Xcode on Windows. Untested-Swift risk is real; `EmailsWidget.swift` uses a fair amount of AppIntents/WidgetKit surface (`AppEntity`, `EntityQuery`, `AppIntentConfiguration`, `AppIntentTimelineProvider`). Real validation is #175's TestFlight build.
- **Unread count is still page-scoped** (inherited from #173) — `shapeEmailSummary` derives `unreadCount` from the loaded inbox page, not the server total. #174 did not change this; #175 can decide whether to feed it `/api/email/counts` totals.
- The `.claude/worktrees/174-emails-widget` worktree is **kept** (PR workflow). Stale `110-full-name-schema` worktree still registered — pre-existing, not this session's, left as-is.

## Mechanical state

- **Branch:** `worktree-174-emails-widget` (the session's work). `main` itself is unchanged at `afd4bbc` until this vault handoff commit lands on it.
- **Commit at session end:** `0822ece` (`widgets: Emails widget UI + per-account configuration (#174)`) on `worktree-174-emails-widget`, pushed to `origin`, [PR #179](https://github.com/ericdaniels22/Nookleus/pull/179).
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none — #174 is UI/native, no DB.
- **Deployed to Vercel:** no — PR #179 not merged. The web layer deploys when it merges.

## Notes for next session

- **The cache contract** the widget decodes: App Group `group.com.aaacontracting.platform`, `UserDefaults` key `emailSummary`, value is a JSON string of `EmailSummarySnapshot`. The Swift `Codable` structs in `EmailsWidget.swift` mirror `src/lib/mobile/email-summary.ts` exactly — **change one side, change the other**. Note `EmailSummaryPreview` now carries `id`.
- **ISO 8601 parsing gotcha** — the web writes `Date.toISOString()`, which always includes fractional seconds. `EmailsWidget.swift`'s `parseISO8601` tries `ISO8601DateFormatter` with `.withFractionalSeconds` first, then falls back to plain. The "Updated Xh ago" line is computed at entry-build time; the timeline refreshes hourly (`.after`) to keep it roughly current while the app stays closed — the app's `reloadAllTimelines()` on foreground handles real freshness.
- **Why the configuration picker reads the snapshot** — the per-mailbox AppIntent's `MailboxQuery` lists accounts from the cached App Group snapshot, not from the API. This keeps the extension network-free and auth-free, consistent with the PRD #56 decision. Side effect: a brand-new install with no cache yet shows an empty mailbox picker until the app has foregrounded once.
- **Worktree convention:** `.claude/worktrees/174-emails-widget` on branch `worktree-174-emails-widget`, cut from `afd4bbc`; `node_modules` junctioned from the main checkout via `New-Item -ItemType Junction` (Windows junctions need no admin). `git worktree add` was used — `EnterWorktree` is documented as failing `EEXIST` here in #172/#173.
- The native slices' automated-test scope is deliberately just the pure TS (`deep-link.test.ts`, `email-summary.test.ts`) — SwiftUI/WidgetKit/AppIntent code carries no tests by repo norm. #174's issue Testing section says exactly this.

## Links

- Build card: [[build-174]]
- Current state: [[00-NOW]]
- Issue: [#174](https://github.com/ericdaniels22/Nookleus/issues/174)
- PR: [#179](https://github.com/ericdaniels22/Nookleus/pull/179)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Setup guide: `ios/App/NookleusWidgets/SETUP.md`
- Related: [[2026-05-21-173-email-summary-cache-pipeline]], [[2026-05-21-172-quick-actions-widget]], [[2026-05-21-56-iphone-widgets-prd-and-slices]]
