---
date: 2026-05-20
build_id: 147
session_type: focused
machine: Vanessas-MacBook-Pro.local
related: ["[[build-65c]]", "[[143-ipad-landscape-prd]]", "[[2026-05-20-146-ipad-landscape-supporting-audit]]"]
---

# #147 iPad-landscape TestFlight verification — handoff — 2026-05-20

## What shipped this session

- **PRD #143 (iPad-landscape support) is fully closed.** Issue [#147](https://github.com/ericdaniels22/Nookleus/issues/147) (HITL TestFlight verification on real devices) closed with a [detailed pass comment](https://github.com/ericdaniels22/Nookleus/issues/147#issuecomment-4501710554); the parent PRD #143 closed with a [wrap comment](https://github.com/ericdaniels22/Nookleus/issues/143#issuecomment-4501720074) summarizing all four slices. iPad Pro 11" + iPhone 13 Pro Max on TestFlight build `1.0 (188)` — rotation, layouts, overlays, mid-task rotation, sidebar persistence, iPhone portrait-lock all PASS.

- **One commit on `main`: `e688a11` `ios: declare exempt encryption to auto-clear TestFlight compliance`** (+2 lines in `ios/App/App/Info.plist`). Adds `ITSAppUsesNonExemptEncryption=false` so every Xcode Cloud build arrives at App Store Connect already export-compliant and skips the per-build "Missing Compliance" gate that was holding builds 175–187 back.

- **Xcode Cloud "Default" workflow configured with TestFlight Internal Testing post-action.** Inside App Store Connect → Xcode Cloud → Default workflow, added a Post-Action: TestFlight Internal Testing → Archive-iOS artifact → DISASTER MASTOURS internal group. This closes the last gap in the push-to-iPad-testable automation chain — Xcode Cloud previously uploaded archives to App Store Connect but did not auto-attach them to a testing group (only ~5 out of ~188 historical builds were auto-attached via the group's "Build Distribution: Automatic for Xcode Builds" toggle).

- **Memory updated:** `project_xcode_cloud_testflight_delivery.md` rewritten to reflect the now-complete two-ingredient automation (plist key + workflow post-action). Old entry said "auto-delivers on push to main" which was incomplete — the delivery was happening, but compliance + group assignment were both still manual.

## What's next

- **No pending work in PRD #143.** All four slices closed:
  - #144 — Info.plist orientation flag — merged 2026-05-20 (`6d5c865`)
  - #145 — Invoice tables `overflow-x-auto` — merged 2026-05-20 (`1c365b5`)
  - #146 — Supporting-screens audit (no-op) — closed 2026-05-20
  - #147 — TestFlight verification — closed 2026-05-20

- **#134 shared/personal email accounts still uncommitted carry-over** — five files (`CONTEXT.md`, `src/app/api/settings/users/[id]/route.test.ts`, `src/app/api/settings/users/[id]/route.ts`, `src/app/api/settings/users/__test-utils__/service-fake.ts`, `src/app/settings/users/page.tsx`) + untracked `out/` — still sitting in the working tree on `main`. Untouched this session. Originally from the 2026-05-19 `/to-issues` slice breakdown work; the prior handoff noted "misbuilt editor + IDOR fix uncommitted." Next session deciding what to do with #134 should triage these first.

- **Next eligible work**: open the queue. No specific slice queued; ready for whatever Eric picks up next.

## Decisions locked

- **`ITSAppUsesNonExemptEncryption=false` is accurate for Nookleus.** Eric explicitly confirmed via AskUserQuestion that Nookleus uses only HTTPS/TLS (system-provided) and has no custom cryptographic code, qualifying it for Apple's standard export-compliance exemption. This is now declared in `ios/App/App/Info.plist`.

- **Plist fix committed directly to `main`, no separate issue/PR.** Eric explicit answer to AskUserQuestion at the moment the diff was ready — chose "Add it now in main, no issue" over the worktree/PR slice convention. Reason: single-line plist change directly unblocking active HITL verification work; not worth the slice overhead.

- **Wait-for-188 over manual-Manage-187.** Eric explicit answer when offered both paths — chose to wait for the new build (Xcode Cloud build 188 from commit `e688a11`) rather than manually clearing build 187's "Missing Compliance" gate. Result: 188 arrived auto-compliant, proving the plist fix end-to-end before depending on it.

## Open threads

- **TestFlight "Build Distribution: Automatic for Xcode Builds" toggle is unreliable.** The DISASTER MASTOURS group has this toggle ON, but only ~5 out of ~188 historical builds were auto-attached via it (the rest sit in App Store Connect's iOS Builds list with an "Add Group" button instead of an assigned group name). The new workflow post-action sidesteps this entirely, but the toggle's behavior remains a black box worth flagging if anyone ever debugs it.

- **#134 carry-over still uncommitted.** Five modified files + untracked `out/` carried over from the 2026-05-19 work. NOT this session's authoring; verbatim unchanged. Will need triage before main is "clean."

- **Dev server may still be running on `:3000` from earlier in the day** (PID 89569 was noted in the prior #146 handoff). Cannot kill under the auto-mode permission policy. Will auto-clean when Vanessa quits the dev server.

## Mechanical state

- **Branch:** main
- **Commit at session end:** this vault commit, sitting on top of `e688a11` (`ios: declare exempt encryption to auto-clear TestFlight compliance`). Chain since session start: `71279c6` (#146 vault commit from earlier today) → `e688a11` (this session's plist commit) → this handoff commit.
- **Uncommitted changes:** 5 files (#134 carry-over, NOT this session) + untracked `out/`
- **Migrations applied this session:** none
- **Deployed to Vercel:** n/a — iOS-only change; no web app code touched, no Vercel deploy triggered
- **Xcode Cloud builds triggered this session:** build 188 from commit `e688a11` (auto-built, auto-cleared compliance via the new plist key, manually added to DISASTER MASTOURS group for verification — the workflow post-action was configured AFTER 188 was already built, so 188 needed the one-time manual group-add)

## Notes for next session

**The push-to-iPad-testable automation is now complete end-to-end.** Future sessions can rely on `git push origin main` → Xcode Cloud builds (~10 min) → App Store Connect upload → auto-clears compliance (plist key) → auto-attaches to DISASTER MASTOURS (workflow post-action) → testable in TestFlight on iPad in roughly ~15 min total, with zero manual App Store Connect clicks. The next iOS-touching build that lands on main will be the first end-to-end test of this — confirm by checking the App Store Connect builds list shows the new build with status "Ready to Test" and the group name in the Groups column without anyone clicking anything.

**Two unrelated TestFlight-flow issues were discovered and resolved while doing #147**:

1. **Builds 175–187 stuck in "Missing Compliance"**: every Xcode Cloud build had been arriving at App Store Connect with the "Missing Compliance" status, requiring a manual "Manage" click + answer "No" to encryption questions before testers could install. Eric had been doing this manually each time when he remembered. Fixed by adding `ITSAppUsesNonExemptEncryption=false` to `Info.plist` in commit `e688a11`.

2. **Xcode Cloud builds not being auto-attached to DISASTER MASTOURS**: even after a build cleared compliance, it sat in the iOS Builds list with an "Add Group" button instead of an assigned group name. Eric (or whoever) had been manually clicking "Add Build to Group" each time. The group's own "Build Distribution: Automatic for Xcode Builds" toggle is on but doesn't reliably fire (only 5 of ~188 historical builds got auto-attached via it). Fixed by adding an explicit "TestFlight Internal Testing" post-action to the Default workflow, with Archive-iOS as the artifact and DISASTER MASTOURS as the target group.

The combination of these two issues explained why Eric was always testing stale builds — the iPad's TestFlight app was correctly showing him `1.0 (146)` (the last build that had compliance cleared AND was assigned to the group) because every newer build was failing one or both of those gates.

**The diagnosis path was useful and worth remembering.** Initial hypothesis was TestFlight client cache — wrong; the iPad was correctly showing the latest *available* build. Real signal came from reading the App Store Connect iOS Builds list authoritatively (via the controller's Chrome MCP read of the open ASC tab), which surfaced "Missing Compliance" + later the empty Groups column. **Pattern**: when "the latest build isn't showing in TestFlight on device," skip the cache-refresh assumption and read App Store Connect's iOS Builds page first — the Status column + Groups column tell you exactly which stage the build is stuck at.

**Memory `project_xcode_cloud_testflight_delivery.md` was already partially correct before this session.** It had noted the `ITSAppUsesNonExemptEncryption` workaround as an option but framed it as "avoidable by adding..." — so the next Claude could have found this if they'd read the memory. The updated entry now reflects that the key is IN the plist and the workflow post-action is configured, so push-to-testable is automated.

**Per the project memory `feedback_isolated_worktree_per_slice`, slice work should normally go in a worktree.** This session's plist change committed directly to `main` per Eric's explicit AskUserQuestion answer ("Add it now in main, no issue"). Reason captured: single-line plist change directly unblocking active HITL verification work; not worth the slice overhead. Don't generalize this exception — the worktree pattern still applies to most slices.

**iPad Pro 11" was the only iPad tested.** The issue's "iPad in the ~1024px-class (iPad mini in landscape)" was not physically tested — coverage of the lower end of the iPad-landscape range relies on the iframe-based audit completed in #146 (which tested 1024 / 1180 / 1366pt). If anything ever surfaces a layout issue at iPad-mini-class widths in real-device usage, that audit's "layout-defensive code already in place" conclusion may need revisiting.

## Links

- Issue: [#147 iPad landscape: TestFlight verification pass on real iPad](https://github.com/ericdaniels22/Nookleus/issues/147)
- Parent PRD: [#143 Big fix - iPad mobile UI does not properly fit the screen in landscape mode](https://github.com/ericdaniels22/Nookleus/issues/143) — CLOSED 2026-05-20
- Verification comment: [#147 comment 4501710554](https://github.com/ericdaniels22/Nookleus/issues/147#issuecomment-4501710554)
- PRD wrap comment: [#143 comment 4501720074](https://github.com/ericdaniels22/Nookleus/issues/143#issuecomment-4501720074)
- Plist commit: [`e688a11`](https://github.com/ericdaniels22/Nookleus/commit/e688a11) `ios: declare exempt encryption to auto-clear TestFlight compliance`
- Current state: [[00-NOW]]
- Prior session handoff: [[2026-05-20-146-ipad-landscape-supporting-audit]]
- Sibling slice handoffs (in PR descriptions): [PR #148](https://github.com/ericdaniels22/Nookleus/pull/148) (#144), [PR #149](https://github.com/ericdaniels22/Nookleus/pull/149) (#145)
