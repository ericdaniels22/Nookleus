---
date: 2026-05-21
build_id: 172
session_type: focused
machine: TheLaunchPad (Claude Code on Windows)
related: ["[[2026-05-21-56-iphone-widgets-prd-and-slices]]"]
---

# Build 172 Handoff — 2026-05-21

## What shipped this session

Issue [#172](https://github.com/ericdaniels22/Nookleus/issues/172) — **slice 1 of 4 of PRD [#56](https://github.com/ericdaniels22/Nookleus/issues/56)** (iPhone widgets) — implemented via `/tdd` in an isolated worktree and **merged to `main` locally** as `0da7c28` (fast-forward). One commit, 11 files, +410.

**Scope was split via an explicit `AskUserQuestion`.** This is a Windows machine — no Xcode, the Swift cannot be compiled or run, and hand-editing `App.xcodeproj/project.pbxproj` to add a new WidgetKit target is error-prone and unverifiable here. The user chose **"Deliver source, leave Xcode target to you"**: the agent delivers every mechanical artifact (TDD'd parser, the `appUrlOpen` handler, the full Swift widget source, entitlements, the URL scheme) and the human does the Xcode-GUI target creation + App Store Connect provisioning.

**Web layer (TDD'd, live on the next deploy):**

- **`src/lib/mobile/deep-link.ts`** — `parseDeepLink(url)` maps a `nookleus://` deep-link URL to an in-app route, `null` for anything unrecognized. Built over **7 RED→GREEN cycles**, 7 tests in `deep-link.test.ts`. Routes: `new-job`→`/intake`, `add-photo`→`/photos`, `compose-email`→`/email?compose=1`, `jarvis`→`/jarvis`. Cycles 5 and 7 (unknown-action, trailing-slash) were green-on-arrival and stand as regression guards; cycle 6 (non-`nookleus://` input) drove the explicit scheme check.
- **`src/components/mobile/deep-link-listener.tsx`** — `DeepLinkListener` client component registers the Capacitor `appUrlOpen` event and `router.push`es the parsed route; guarded by `Capacitor.isNativePlatform()` so it is a no-op on web. Mounted in `src/app/layout.tsx`.

**iOS native source (written, NOT compiled — no Xcode on Windows):**

- **`ios/App/NookleusWidgets/`** — `NookleusWidgetsBundle.swift` (`@main WidgetBundle`), `QuickActionsWidget.swift` (a `StaticConfiguration` widget — medium + large, four `Link` deep-link buttons, single-entry `.never` timeline, iOS-17 `containerBackground` with a pre-17 fallback), `Info.plist`, `NookleusWidgets.entitlements`.
- **`ios/App/App/Info.plist`** — `CFBundleURLTypes` registering the `nookleus` URL scheme.
- **`ios/App/App/App.entitlements`** — App Group `group.com.aaacontracting.platform`.
- **`ios/App/NookleusWidgets/SETUP.md`** — the step-by-step Xcode + App Store Connect guide for finishing the target.

**Verification:** full suite **775 passed (124 files)** — baseline was 768/123, +7 new parser tests. `tsc` clean except the pre-existing `sync-folder-incremental.test.ts` `TS2322`. `eslint` clean on the four changed web files. The Swift was **not** compiled — no Xcode in this environment.

## What's next

**This handoff exists to finish #172's native half on a Mac.** On the MacBook session:

1. Follow **`ios/App/NookleusWidgets/SETUP.md`** — open `ios/App/App.xcworkspace`, create the Widget Extension target named `NookleusWidgets`, swap in the provided Swift files, add the **App Groups** capability to both the App and `NookleusWidgets` targets, register the extension bundle id (`com.aaacontracting.platform.NookleusWidgets`) + the App Group in the Apple Developer portal, confirm Xcode Cloud signing.
2. **Push `main`** — it is 1 commit ahead of `origin/main`, unpushed.
3. Once the target builds, #172's AC#1–3 (widget adds to the home screen, buttons deep-link, renders signed-out) get verified on a real device — that is slice **[#175](https://github.com/ericdaniels22/Nookleus/issues/175)** (TestFlight). #172 stays open until the Xcode/ASC work lands.
4. Then slices **[#173](https://github.com/ericdaniels22/Nookleus/issues/173)** (email-summary cache pipeline) → **[#174](https://github.com/ericdaniels22/Nookleus/issues/174)** (Emails widget UI) in dependency order.

## Decisions locked

- **Scope split** (user `AskUserQuestion`): "Deliver source, leave Xcode target to you." Reason — Windows machine, no Xcode; hand-editing `project.pbxproj` for a new target is unverifiable and error-prone.
- **Deep-link scheme** is `nookleus://<action>`, host-based. The action names — `new-job`, `add-photo`, `compose-email`, `jarvis` — are the **contract shared** between the Swift widget's hard-coded URLs and the TS `ROUTES` map. Rename one ⇒ change both.
- **`add-photo` → `/photos`**: there is no job-agnostic photo-capture route (capture lives at `(mobile)/jobs/[id]/capture`, job-scoped). `/photos` is the closest job-agnostic destination for a data-free, signed-out widget button.
- **Commit references `#172` without a `Closes` keyword** — the issue stays open until the Xcode target + ASC provisioning land.
- **Merged locally**, not via PR, per the user's choice. `main` not pushed.

## Open threads

- **`main` is 1 commit ahead of `origin/main`, unpushed.** Pushing triggers Vercel's auto-deploy of the web layer — harmless (`DeepLinkListener` is a no-op off-native and nothing emits `nookleus://` yet).
- **#172 still OPEN** — Xcode target creation, App Group capability, ASC provisioning all pending.
- **The Swift was never compiled** — no Xcode on Windows. Untested-Swift risk; real validation is #175's TestFlight build.
- **`git worktree remove` hit a transient OneDrive file lock** on `.git/worktrees/172-quick-actions-widget`; cleaned up manually (worktree dir + admin entry + branch all removed). The `.claude/worktrees/` tree is under OneDrive — future worktree cleanups may need the same manual follow-up.
- The **`EnterWorktree` native tool failed** with `EEXIST: mkdir '.claude/worktrees'` (the dir already exists) — fell back to `git worktree add`, which is the established repo convention anyway. Stale leftover dirs `111-merge-fields` and `86-request-context-cleanup` still sit in `.claude/worktrees/`, plus the registered `110-full-name-schema` worktree.

## Mechanical state

- **Branch:** `main`.
- **Commit at session end:** `0da7c28` (`widgets: Quick Actions widget + deep-link foundation (#172)`) — before this vault commit.
- **`origin/main`:** `0163a14` — local `main` is **1 ahead, 0 behind, unpushed**.
- **Uncommitted changes:** none (before this handoff write).
- **Migrations applied this session:** none — #172 is UI/native, no DB.
- **Deployed to Vercel:** no — `main` not pushed.
- **Worktree:** `.claude/worktrees/172-quick-actions-widget` on `worktree-172-quick-actions-widget` — created, used, removed at session end.

## Notes for next session

- **`ios/App/NookleusWidgets/SETUP.md` is the canonical guide** — read it first on the Mac.
- The committed `ios/App/NookleusWidgets/` files are **inert until the Xcode target exists** — committing/merging them does not change the app build. `App.entitlements` is unreferenced (`project.pbxproj` has no `CODE_SIGN_ENTITLEMENTS`), so it does not affect signing until wired via the App Groups capability.
- **AC#4** (deep-link parser unit-tested) is the only #172 acceptance criterion verifiable off a Mac — it is done. **AC#1–3** verify on-device in #175.
- The widget extension is **embedded in the App target**, so Xcode Cloud archives it with the app on push — no new workflow needed, just signing assets for the new bundle id.

## Links

- Build card: [[build-172]]
- Current state: [[00-NOW]]
- Issue: [#172](https://github.com/ericdaniels22/Nookleus/issues/172)
- Parent PRD: [#56](https://github.com/ericdaniels22/Nookleus/issues/56)
- Setup guide: `ios/App/NookleusWidgets/SETUP.md`
- Related: [[2026-05-21-56-iphone-widgets-prd-and-slices]]
