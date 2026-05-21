---
date: 2026-05-21
build_id: 175
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[2026-05-21-174-emails-widget-xcode]]", "[[2026-05-21-173-email-widget-bridge-xcode]]"]
---

# Build 175 Handoff — 2026-05-21

## What happened this session

Started slice [#175](https://github.com/ericdaniels22/Nookleus/issues/175) —
the **final slice of PRD [#56](https://github.com/ericdaniels22/Nookleus/issues/56)**,
TestFlight on-device verification — and **paused it partway** when the
verification surfaced a real bug. **No code shipped; no commits.** The session
also did a small triage-label fix on #174.

- **Opened with `/orient`** — no drift (`main` at `9602186`, the fifty-second
  session's vault handoff commit; working tree clean, in sync with
  `origin/main`).
- **Relabeled #174** `ready-for-agent` → `ready-for-human`. The
  `ready-for-human` label did not exist in the repo — only `ready-for-agent`
  of the canonical five (`docs/agents/triage-labels.md`) was instantiated — so
  it was created (`#1D76DB`, "Requires human implementation"). An explanatory
  comment was added. #174 has no remaining agent work; it stays OPEN pending
  #175's on-device verification.
- **Started #175 verification on an iPad** (TestFlight **build 223**). The user
  chose iPad over the issue's "real iphone" wording via `AskUserQuestion`
  ("iPad, count it") — the widget code paths are identical on iPadOS. Tracked
  against a 12-item task list mirroring the issue checklist.

## Verification results

**Quick Actions widget (#172) — items 1–5: ✅ ALL PASS.**
Adds to the home screen in medium + large; New job / Add photo / Compose
email / Open Jarvis all deep-link to the correct flows.

**Emails widget (#173/#174) — items 6–12: ⛔ BLOCKED by a bug** (see below).

## The blocker

The Emails widget **never receives its App Group snapshot** on build 223:

- The widget face shows the **"Open the app to sync"** empty state — i.e.
  `EmailSummaryStore.loadSnapshot()` returns `nil` on the widget side.
- The mailbox configuration picker is **empty** — `MailboxQuery.allMailboxes()`
  returns `[]`, so there is nothing to select (item 7 fails).

Diagnosis ruled out the easy explanations:

- **Prod DB (`rzzprgidqbnqcdupmpfe`) is healthy** — both accounts active and
  synced today: `team@aaadisasterrecovery.com` (id
  `23d9e8e3-541d-4966-bbea-1088628c4a68`, label `TEAM`, 52 emails / 51 unread);
  `eric@aaacontracting.com` (id `c8fd2f3b-f7f9-433d-9b6f-e23f04ecd25d`, label
  `Eric AAA Contracting`, 101 / 20).
- **The code path is statically correct** — `CODE_SIGN_ENTITLEMENTS` wires both
  targets; App Group `group.com.aaacontracting.platform` is declared in both
  `App.entitlements` and `NookleusWidgets.entitlements`; the plugin and widget
  use identical suite/key strings (`group.com.aaacontracting.platform` /
  `emailSummary`); the JS→Swift param contract matches (`{ summary }` ↔
  `call.getString("summary")`).
- The user confirmed opening the app to the **inbox** (the snapshot-write
  trigger) and **deleting + re-adding** the widget — still empty.

So it is a **runtime fault**, one of three:

1. The `EmailWidgetBridge` Capacitor plugin isn't registered → the app's write
   call no-ops (the error is swallowed by a `.catch(() => {})` in
   `publishEmailSummary`).
2. The plugin runs but the **app side** can't open the App Group →
   `writeEmailSummary` rejects (`"App Group … is unavailable"`).
3. The write succeeds but the **widget extension** can't read the container →
   App Group present in the entitlements file but not provisioned for the
   extension's App ID `com.aaacontracting.platform.NookleusWidgets` in the
   Apple Developer portal.

## What's next

- **Safari Web Inspector probe** against the Nookleus WKWebView. The iPad app
  loads the live Vercel site, so it is fully inspectable from the Mac — **no
  rebuild needed**. Setup was handed to the user (iPad: Settings → Apps →
  Safari → Advanced → Web Inspector; Mac: Safari → Advanced → Show features for
  web developers; connect via USB; Safari → Develop → iPad → Nookleus). Once
  the Console is open, probe: confirm `Capacitor.isNativePlatform()`, check
  `window.Capacitor.Plugins.EmailWidgetBridge` exists, then manually call
  `writeEmailSummary` with a probe snapshot and read the resolve/reject. That
  discriminates hypotheses 1/2/3.
- **Fix** the identified cause, then likely cut a **new Xcode Cloud build**
  (note: the Default workflow is now scoped to `ios/**` paths — a fix touching
  only `ios/` will auto-build; a web-only fix will not).
- **Resume #175 items 6–12.** Item 11 (empty state) still needs a fresh
  install.
- PRD #56 cannot close until the bug is fixed and items 6–12 pass.

## Decisions locked

- **Verify #175 on iPad and count it as the pass** — user `AskUserQuestion`:
  "iPad, count it". Widget code paths are identical on iPadOS.
- **#174 relabeled `ready-for-human`** — no agent work remains; on-device
  verification is a human task tracked under #175.

## Open threads

- **The snapshot-pipeline bug** — the blocker above; awaiting the Web Inspector
  probe.
- **UX paper-cut (deferred behind the blocker):** the mailbox picker lists
  accounts by `label` only — no email address — so `team@aaadisasterrecovery.com`
  shows as the cryptic `TEAM`. `EmailSummaryAccount` already `Pick`s
  `email_address` but `shapeEmailSummary` drops it before the snapshot. Worth
  threading through as a `MailboxEntity` subtitle.
- **The bug is currently a comment on #175, not its own issue.** If preferred,
  split it into a dedicated bug issue (it is a defect in #174's feature, not a
  verification step).
- A **pre-existing email-account disconnect** (unrelated to the widgets) was
  found this session and **self-resolved** by the user reconnecting the
  account — no longer open.

## Mechanical state

- **Branch:** `main`.
- **Commit at session end:** `9602186` — **unchanged from session start**; no
  code commits this session.
- **Uncommitted changes:** this handoff file + the `00-NOW.md` update only.
- **Migrations applied:** none — the prod queries (`email_accounts`, `emails`)
  were **read-only SELECTs** for diagnosis.
- **Deployed to Vercel:** no.
- **GitHub side (not in git):** created the `ready-for-human` label; relabeled
  #174 and commented on it; posted the verification status comment on #175.

## Notes for next session

- **Data path, for reference:** `src/components/email-inbox.tsx` calls
  `useEmailSummaryCache(emails, accounts, folder === "inbox")` →
  `shapeEmailSummary` (`src/lib/mobile/email-summary.ts`) → `publishEmailSummary`
  (`src/lib/mobile/email-widget-bridge.ts`) → `EmailWidgetBridge` plugin
  (`ios/App/App/EmailWidgetBridgePlugin.swift`, `writeEmailSummary` +
  `reloadWidgets`) → App Group `UserDefaults`. The widget
  (`ios/App/NookleusWidgets/EmailsWidget.swift`) reads it via
  `EmailSummaryStore.loadSnapshot()`; the config picker is
  `MailboxQuery.allMailboxes()`.
- **The snapshot is only written while the app is foregrounded on the inbox**
  (`folder === "inbox"`, `accounts.length > 0`). The widget never networks.
- **Most likely root cause** if the Web Inspector shows the write resolving
  cleanly: hypothesis 3 (App Group not on the extension's App ID in the portal).
  Build 223's Xcode Cloud signing succeeding does not fully rule this out —
  worth checking App Store Connect / the Developer portal.
- TestFlight build 223 (`ed637cb`) is on the **DISASTER MASTOURS** internal
  group; a fix build will need the same group attach if Xcode Cloud's
  auto-attach is unreliable (it was for 223).

## Links

- Build card: [[build-175]]
- Current state: [[00-NOW]]
- Issue: [#175](https://github.com/ericdaniels22/Nookleus/issues/175)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Status comment: [#175 comment](https://github.com/ericdaniels22/Nookleus/issues/175#issuecomment-4513235169)
- Prior handoff: [[2026-05-21-174-emails-widget-xcode]]
