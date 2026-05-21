---
date: 2026-05-21
build_id: 56
session_type: focused
machine: vm (Claude Code on the web)
related: ["[[2026-05-20-159-prd-152-jobs-view-modes]]", "[[2026-05-21-164-cover-from-comfortable-row]]"]
---

# Build 56 Handoff — 2026-05-21

## What shipped this session

- **Issue [#56](https://github.com/ericdaniels22/Nookleus/issues/56) grilled into a PRD.** #56 was a bare `/grill-me` stub ("/grill-me for iPhone widgets features"). `/grill-me` ran ~6 questions one at a time; the user scoped the feature to **two iOS home-screen widgets**:
  - **Quick Actions widget** — static, deep-link buttons only: Open Jarvis, New job, Add photo, Compose email. No data, no auth.
  - **Emails widget** — unread count + latest 2–3 message previews; mailbox **configurable per widget instance** via an AppIntent; "Updated Xh ago" freshness line; "Open the app to sync" empty state when no cache exists.
  - Jobs / schedule / business-metrics widgets and Lock Screen widgets were explicitly **dropped** during the grill.
- **`/to-prd` published the PRD to #56** — retitled "New Feature: iPhone widgets (Quick Actions + Emails)", labelled `ready-for-agent`, 17 user stories, 5 modules.
- **`/to-issues` broke the PRD into 4 dependency-ordered slice issues:**
  - **[#172](https://github.com/ericdaniels22/Nookleus/issues/172)** — Quick Actions widget + WidgetKit extension foundation (new Xcode target, App Group entitlement, `nookleus://` deep-link scheme, Capacitor `appUrlOpen` routing). `ready-for-agent`, **no blockers**.
  - **[#173](https://github.com/ericdaniels22/Nookleus/issues/173)** — email-summary cache pipeline (custom Capacitor Swift plugin + App Group write + web summary-producer hook). `ready-for-agent`, blocked by #172.
  - **[#174](https://github.com/ericdaniels22/Nookleus/issues/174)** — Emails widget UI + per-account configuration. `ready-for-agent`, blocked by #172 + #173.
  - **[#175](https://github.com/ericdaniels22/Nookleus/issues/175)** — TestFlight verification on a real iPhone (HITL). **Unlabelled**, blocked by #172 + #173 + #174.
- A tracking comment listing the 4 slices was posted on parent PRD #56.
- **No code, no commits, no migration, no deploy** — pure issue-tracker work. This branch carries only this vault handoff commit.

## What's next

- **Implement [#172](https://github.com/ericdaniels22/Nookleus/issues/172) first** — no blockers, and it de-risks the native plumbing (new WidgetKit target, App Group entitlement, deep-link scheme) before the data-backed widget is built.
- Then **#173 → #174 → #175** in dependency order.
- #175 is human-in-the-loop TestFlight verification — it closes PRD #56 when it passes.

## Decisions locked

Each grill answer below was explicitly chosen by the user via `AskUserQuestion`, one at a time:

- **Scope = two widgets**: Quick Actions + Emails. Jobs/schedule/metrics widgets dropped.
- **Emails widget** shows unread count + previews; mailbox is **user-configurable per widget instance**.
- **Quick Actions** buttons: Open Jarvis, New job, Add photo, Compose email.
- **Sizes**: home-screen medium + large only — no Lock Screen widgets.
- **Data architecture = app-writes-cache** — the app writes a per-account email summary into a shared App Group container and reloads widget timelines; the widget extension does no networking and no auth. A live widget API and direct Supabase-from-Swift were both presented and rejected.
- Emails widget shows a last-updated time; empty state prompts to open the app.
- **4 slices as proposed**; native code slices (#172–#174) labelled `ready-for-agent`.

## Open threads

- **`ready-for-human` label does not exist in the repo**, and no label-create MCP tool is available. Slice #175 (HITL TestFlight verification) was left **unlabelled** — matching the #147 HITL-verification precedent, which was also unlabelled, with the HITL nature stated explicitly in the #175 body. If the canonical five-label triage vocabulary is meant to be enforced (see `docs/agents/triage-labels.md`), someone with web/repo settings access should create `ready-for-human` and apply it to #175 (and retroactively #147).
- **Slices #172–#174 are genuinely native iOS work** — a new Xcode/WidgetKit extension target, an App Group entitlement, Swift, a custom Capacitor plugin. They are labelled `ready-for-agent`, but an AFK agent can only *write* the Swift/web code; it cannot build in Xcode or run a simulator in this environment. Real validation happens only on #175's TestFlight build. The untested-Swift risk is higher than the usual web slices — worth a human eye on the #172/#173/#174 PRs.
- **App Store Connect / provisioning** — the new widget extension target needs its own bundle id + provisioning profile and wiring into the existing Xcode Cloud workflow (set up in #143/#147). That sub-step inside #172 is likely human/Xcode-bound.

## Mechanical state

- **Branch:** `claude/investigate-issue-56-vXs6v`.
- **Commit at session end:** `73c2907` (`vault: 00-NOW — PRD #152 closed (all 6 slices delivered)`) before this vault commit — this branch carries only the handoff commit on top of `main`.
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none.
- **Deployed to Vercel:** no — no code changed.

## Notes for next session

- The canonical spec for this feature is the **PRD body on #56** plus the **4 slice issue bodies (#172–#175)** and the #56 tracking comment. Read those before implementing — they carry the full scope, acceptance criteria, and rationale.
- **Architecture rationale to carry forward**: the WidgetKit extension is deliberately network- and auth-free. The Capacitor app, while open, hands the native shell a per-account email summary; the shell writes it to a shared App Group container and calls `WidgetCenter.reloadAllTimelines()`. The widget renders that snapshot. This was chosen over a live widget API and over a direct Supabase Swift SDK call specifically so the extension never re-implements auth/session handling. The trade-off accepted: widget data is only as fresh as the last app foreground — mitigated by the "Updated Xh ago" line.
- The iOS app is a **Capacitor shell** (`capacitor.config.ts` → loads the remote `https://aaaplatform.vercel.app`, `webDir: 'out'`). There are currently **zero** widgets in `ios/` and **no deep-link URL scheme** — slice #172 introduces the `nookleus://` scheme and the Capacitor `appUrlOpen` handler.
- This branch is `claude/investigate-issue-56-vXs6v` and only carries the vault handoff. The actual widget implementation should happen on per-slice branches/worktrees per `feedback_isolated_worktree_per_slice`.
- This session was the first run of `/grill-me` → `/to-prd` → `/to-issues` done **conversationally** — those skills are not installed in the web environment (only `orient`, `handoff`, `verify`, `code-review`, etc. are). The workflow still produced the same artifacts as the packaged skills would (cf. PRD #152).

## Links

- Build card: [[build-56]]
- Current state: [[00-NOW]]
- PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Slices: [#172](https://github.com/ericdaniels22/Nookleus/issues/172), [#173](https://github.com/ericdaniels22/Nookleus/issues/173), [#174](https://github.com/ericdaniels22/Nookleus/issues/174), [#175](https://github.com/ericdaniels22/Nookleus/issues/175)
- Related: [[2026-05-20-159-prd-152-jobs-view-modes]] (same `/grill-me` → `/to-prd` → `/to-issues` workflow)
