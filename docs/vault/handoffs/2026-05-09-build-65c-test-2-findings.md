---
date: 2026-05-09
build_id: 65c-test-2-findings
session_type: mixed
machine: Vanessas-MacBook-Pro.local
related: ["[[build-65c]]", "[[2026-05-09-build-65c-impl-tasks-14-15-partial-16]]", "[[2026-05-08-build-65c-spec-and-plan]]"]
---

# Build 65c Handoff (Test 2 findings) — 2026-05-09 (evening)

## What shipped this session

**No commits.** This session was a real-device Test 2 attempt that surfaced two material findings; both are open at session end. The morning session's commits remain HEAD on `build-65c-upload-pipeline`; PR #52 still open against `main`.

Concrete operations performed:

- **Repointed `capacitor.config.ts`** `server.url` from `https://aaaplatform.vercel.app` → `https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app` (PR #52 preview URL). **Reverted before the handoff commit; never committed.**
- **Ran `npx cap sync ios`** — regenerated iOS project against the new server URL. All 6 plugins re-registered cleanly (camera-preview, app, filesystem, network, background-task, secure-storage).
- **Reinstalled on Eric's iPhone via Xcode** (`npx cap open ios` → Run on USB-cabled iPhone, personal team signing).
- **Ran Test 2 (airplane mode + ~100 captures) partially.** Toggled airplane ON, snapped ~100 photos, queue badge climbed steadily to 100 (✅ — the offline write+queue layer works as designed). Tried to save+exit camera; **app stranded on "Connecting…" splash** because navigation requires the remote app shell. Toggled airplane OFF; splash recovered within seconds. **Then observed: only "a few" of 100 photos visible in the in-app photos section after reconnect.** Exact count unverified; Supabase source-of-truth query NOT yet run.

## Two findings, both open

### Finding A — App stranded offline (architecture)

**What:** When the iPhone is fully offline, navigating the app (e.g., exiting camera) triggers a remote route fetch that fails, leaving the user on `"Connecting…"`. The Capacitor WebView is loading the live Next.js app from `server.url`; there is no offline shell. `webDir: 'out'` is essentially empty (only `index.html`). Next.js 16.2.2; no `output: 'export'`, no service worker, no manifest.

**Severity:** Material for field crews working in basements / remote sites with zero signal.

**Decision locked:** **NOT a 65c blocker.** Eric verbatim: *"I think this should be considered in an entirely separate build - not mid smoke test for this camera feature."* Discovering the issue mid-smoke does not make it 65c's problem; 65c is the upload pipeline, not the app shell.

**Disposition:** Defer to a separate future build (likely ~Build 67 "offline shell"). Brainstorming session was opened, exited cleanly without producing a spec, by Eric's call. The forks discussed for the future build:

- **Option A** (recommended): New mobile-only `(mobile)/jobs` page, client-rendered with cached job list. Smallest scope; web shell unchanged.
- **Option B:** Make existing shared `/jobs` offline-capable. Big rewrite + web-app risk.
- **Option C:** Mobile landing + shared web routes deeper. Re-creates the bug as soon as the user navigates past landing.

### Finding B — Possible queue-drain anomaly (UNVERIFIED)

**What:** After airplane-off recovery, Vanessa observed only "a few of 100" photos in the job's in-app photos section.

**Severity (potential):** v1 blocker IF real data loss. The queue is THE thing 65c is shipping.

**Verification status:** Source-of-truth Supabase query NOT run. Test job ID NOT captured. Drain timing not measured.

**Hypothesis set (forming, not committed):**

| # | Hypothesis | Prior | Confirms it | Refutes it |
|---|---|---|---|---|
| H2 | Queue worked, UI shows stale/partial state (same family as yesterday's "Review showed 0 of 151 in DB") | ~45% | Supabase has ~100 photos for the test job | Supabase has only ~5 |
| H3 | Drain still in progress; checked too soon (100 × 2-5s = real wall time) | ~25% | Photo count climbing on re-check | Count stuck |
| H1 | Real loss — failed offline upload attempts burned retry budget; only never-attempted captures drained on reconnect | ~15% | Sidecars gone from disk + low DB count + console errors | Sidecars still queued (then it's H3) |
| H4 | Some captures never wrote to disk (rapid-fire shutter dropped writes); badge counted optimistically | ~10% | Disk has < 100 sidecars | Disk has ~100 sidecars |
| H5 | "Photos section" naturally paginates; "few visible" means scroll-for-more | ~5% | Scrolling reveals more | Scrolling reveals nothing |

**Disposition:** `superpowers:systematic-debugging` Phase 1 opened, paused at evidence-gathering. **PR #52 cannot merge until this is resolved** — if H2/H3/H5, pipeline is fine; if H1/H4, code fix needed.

## Decisions locked

- **Offline-shell stranding (Finding A) is deferred to a separate future build.** Eric verbatim: "I think this should be considered in an entirely separate build - not mid smoke test for this camera feature." Confirmed during brainstorming exit.
- (No other decisions confirmed; the queue-drain investigation paused mid-Phase-1.)

## Open threads

- **CRITICAL — queue-drain anomaly unverified.** Until source-of-truth Supabase query confirms the 100 captures landed (or didn't), PR #52 must not merge. Unblocks by: (1) get Test 2 job ID from Vanessa, (2) query AAA prod `photos` table filtered by `job_id` AND `uploaded_at` clustered around the Test 2 timestamp (~21:50 CDT 2026-05-09 based on the iPhone screenshot timestamp 9:50 PM), (3) compare count to ~100. Job ID may be the same as yesterday's `0ccaacb2-98a5-45a5-9fce-98ce782b2bde` (Vanessa was supposed to use a fresh one but we never confirmed). Disambiguate by upload timestamp.
- **`capacitor.config.ts` reverted to production URL before the handoff commit (matching the morning session's discipline).** For continued smoke testing on the preview, the next session needs to re-edit + `npx cap sync ios` + reinstall via Xcode. Preview URL: `https://aaaplatform-git-build-65c-d9efd7-aaa-disaster-recovery-e5661f28.vercel.app`.
- **Offline-shell finding (Finding A) needs a durable home beyond this handoff.** Stub build card in `docs/vault/` was the planned location; held until Finding B is resolved so both can be captured together (or in one consolidated note).
- **Test 2 cleanup grew.** If captures DID upload to AAA prod, today's batch (whatever fraction landed) needs deletion alongside yesterday's 151 in Task 17 cleanup before merge.
- **Tests 3-5 (failure path) and Test 6 (force-quit recovery) still unrun.** They don't depend on offline navigation — only Test 2 did. Decision pending: run them after Finding B is resolved, or trust Test 1's pipeline proof and merge.
- **Standing carry-overs unchanged from morning handoff.** PR #52 awaiting overall ship decision; Bug B (camera-stuck on early-exit) fix shipped but device-validation still deferred to 65b.1; 65b.1 follow-up list (~6 items); workplan Step 5 Supabase email templates; AAA QB sandbox token expired since 2026-04-21; 67c2 reviewer F4–F8; 5xx redactor sweep across remaining ~80 routes.

## Mechanical state

- **Branch:** `build-65c-upload-pipeline`
- **Commit at session end:** vault handoff for this session (the previous tip was `ca29406`; this session adds the vault commit on top)
- **In sync with `origin/build-65c-upload-pipeline`:** YES (after handoff push)
- **Local `main`:** unchanged, in sync with `origin/main` at `a8dec0b`
- **Uncommitted changes:** none (capacitor.config.ts reverted; gitignored `out/` is the only untracked path)
- **Migrations applied this session:** none
- **Deployed to Vercel:** no new deploys (PR #52 preview unchanged)
- **Distributed to TestFlight:** no
- **Real-device install:** local Xcode reinstall on Eric's iPhone with the preview URL config (overwrites the morning's preview install). The iPhone install is now stale relative to the reverted config — re-syncing required if continuing smoke against the preview.
- **Memories saved this session:** none

## Notes for next session

- **Start with the Supabase query.** Don't make any other decisions until you know how many of the ~100 Test 2 captures actually landed in AAA prod. Easiest path: `SELECT job_id, COUNT(*), MIN(uploaded_at), MAX(uploaded_at) FROM photos WHERE uploaded_at > '2026-05-09 21:30:00' AND uploaded_from = 'mobile' GROUP BY job_id`. That gives you the job ID + the count in one query and disambiguates from yesterday's 151 by timestamp.
- **The "few of 100" observation is exactly the same shape as yesterday's "Review screen showed 0 of 151."** Yesterday turned out to be a UI bug, not data loss — the DB had everything. H2 is the strongest prior for that reason. Don't assume queue failure without evidence.
- **The original Test 2 plan ("toggle airplane on, snap, exit, watch the queue drain on toggle-off") is fundamentally not runnable in current Capacitor architecture** because exit-camera triggers a remote route fetch. The queue's own behavior CAN be tested without the navigate-out step (snap → wait IN camera view → toggle airplane off → watch badge tick down without leaving camera). Future smoke runs of "true offline behavior" should bake this in until the offline shell ships.
- **The brainstorming + systematic-debugging skill chain worked well.** Brainstorming hard-gate prevented us from designing offline-shell mid-smoke; user's "separate build" call was the right exit. Systematic-debugging iron law prevented us from jumping to "the queue is broken" without evidence.
- **Don't take the "no commits" outcome as failure.** This session produced two filed findings with clear next steps + cleanly avoided a scope creep that would have morphed 65c into a much bigger build.

## Links

- Build card: [[build-65c]]
- Current state: [[00-NOW]]
- Predecessor (morning): [[2026-05-09-build-65c-impl-tasks-14-15-partial-16]]
- Spec + plan: [[2026-05-08-build-65c-spec-and-plan]]
- PR #52: https://github.com/ericdaniels22/Nookleus/pull/52
- AAA prod Supabase project: `rzzprgidqbnqcdupmpfe`
