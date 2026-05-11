---
build_id: 65c
title: Mobile upload pipeline (sidecar queue + AAA prod uploads)
status: ready-to-merge
phase: mobile
started: 2026-05-08
shipped: null
guide_doc: null
spec_file: docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md
plan_file: docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md
pr: https://github.com/ericdaniels22/Nookleus/pull/52
handoff: "[[2026-05-09-build-65c-test-2-findings]]"
related: ["[[build-65a]]", "[[build-65b]]", "[[2026-05-08-build-65c-spec-and-plan]]", "[[2026-05-09-build-65c-impl-tasks-14-15-partial-16]]", "[[2026-05-09-build-65c-test-2-findings]]"]
---

#status/ready-to-merge #area/mobile #build/65c

## Fix verification (2026-05-11)

Commits `3d005f7` (fix) + `5785fb5` (this card) pushed to `build-65c-upload-pipeline`. Vercel preview rebuilt. Real-iPhone smoke against AAA prod:

| Test | Captures | Landed | Result |
|---|---|---|---|
| Finding C backfill (87 pre-65c "unknown" sidecars) | 87 | **87** | ✅ |
| Airplane-mode burst (5 baseline online + 30 offline) | 35 | **35** | ✅ — Finding B fix proven |
| Retry-all-failed UI on the 52 originally stranded | 52 | **52** | ✅ — recovery path proven |

**Zero data loss across 174 captures.** PR #52 unblocked.

## Scope

Sidecar-journal-driven upload queue for camera captures: write each photo + metadata to a local sidecar JSON the moment it's taken, then drain to AAA prod `photos` via a worker that handles backoff, race detection (owner-PID), retry budgets, and Capacitor `beforeExit` background-task hooks. Plus an in-pass fix to web upload's hardcoded `taken_by: 'Eric'` and the new `uploaded_from` / `client_capture_id` columns.

Tests 14-16 of the 17-task plan complete; PR #52 open against `main`. **Real-iPhone Test 1 (morning 2026-05-09) proved the pipeline end-to-end — 163 photos uploaded to AAA prod for test job `0ccaacb2-...`, all `uploaded_from='mobile'`, EXIF dimensions correct, profile-resolved `taken_by` correct.**

## Open findings (both surfaced 2026-05-09 evening Test 2)

### Finding A — App stranded offline (architecture)

When the iPhone is fully offline, navigating the app (e.g., exiting camera) triggers a remote route fetch that fails, leaving the user on `"Connecting…"`. The Capacitor WebView loads the live Next.js app from `server.url`; `webDir: 'out'` contains only `index.html` (no offline shell, no `output: 'export'`, no service worker, no manifest).

**Decision locked:** NOT a 65c blocker. Eric verbatim: *"I think this should be considered in an entirely separate build - not mid smoke test for this camera feature."* Deferred to a separate future build (likely Build 67 "offline shell"). Three options surfaced in brainstorming before exit:

- **Option A (recommended):** New mobile-only `(mobile)/jobs` page, client-rendered with cached job list. Smallest scope; web shell unchanged.
- **Option B:** Make existing shared `/jobs` offline-capable. Big rewrite + web-app risk.
- **Option C:** Mobile landing + shared web routes deeper. Re-creates the bug as soon as the user navigates past landing.

### Finding B — Partial upload-loss during airplane-mode burst (RESOLVED — H1 CONFIRMED, FIX SHIPPED 2026-05-11 commit `3d005f7`)

**Observation:** Vanessa snapped ~100 captures in airplane mode; queue badge climbed steadily to 100 ✅. After reconnect, she observed only "a few of 100" photos in the in-app photos section.

**Verification 2026-05-11 (this entry):**

Supabase query against AAA prod `photos` filtered on `job_id = '0ccaacb2-98a5-45a5-9fce-98ce782b2bde' AND uploaded_from = 'mobile'`:

| Window | Photos in DB |
|---|---|
| Test 1 (morning) — created_at < 2026-05-10 02:00 UTC | **163** |
| Test 2 (evening) — created_at ≥ 2026-05-10 02:00 UTC | **48** |
| **Total for job** | **211** |

Test 2 timing details:
- **taken_at**: 02:49:06 → 02:49:41 UTC (35-second capture window, ~2.8/s rapid-fire)
- **created_at**: 03:09:49 → 03:10:04 UTC (15-second drain burst, ~20 minutes after capture)

Nookleus web UI at `/jobs/0ccaacb2-.../photos` shows **211 thumbnails** — exact match to DB. Photos tab badge: `211`. No pagination cutoff, all visible under "Saturday, May 9th, 2026".

**Hypothesis status after verification:**

| # | Hypothesis | Verification result | Status |
|---|---|---|---|
| H2 | Queue worked; UI showed stale/partial state | Web UI shows 211 = DB exact match | **Ruled out on web view** — Vanessa's "few of 100" is iPhone-view-specific or a separate sub-bug |
| H3 | Drain still in progress; checked too soon | Drain finished 03:10:04 UTC in 15s | **Ruled out** |
| H5 | Photos section paginates | Single dated group, no "load more" | **Ruled out** |
| H1 | Real loss — failed offline upload attempts burned retry budget | **CONFIRMED — 2026-05-11 via on-device sidecar audit** | **RESOLVED** |
| H4 | Some captures never wrote to disk during rapid-fire shutter | All 100 captures wrote sidecars successfully | Ruled out |
| H6 | Queue badge inflated; only ~48 fired | 52 failed sidecars + 48 succeeded = 100 = badge count | Ruled out |

**iPhone-side audit (2026-05-11):**

In session `dea218ba-eba7-4903-93d0-feff7d58a220` of test job `0ccaacb2-...`:

| Field | Value |
|---|---|
| Sidecars on disk | **52** |
| Photos on disk | **52** |
| upload_state | All `failed` |
| retry_count | All `4` |
| last_error | All `"Load failed"` (WKWebView generic offline fetch error) |
| taken_at span | 02:48:41 → 02:49:05 UTC |

DB-landed photos for same session: taken_at **02:49:06 → 02:49:41 UTC** (48 photos). **52 failed + 48 succeeded = 100 captures, matching Vanessa's badge claim.**

**Failure mechanism (inferred):**

1. Airplane mode was already ON when Vanessa started snapping at 02:48:41 UTC.
2. Captures 1–52 fired upload attempts immediately via the `'65c-capture-written'` event listener (commit `3cf8d04`). Each `fetch()` returned `"Load failed"` (WKWebView's standard offline error).
3. Worker burned through retry budget `[1s, 5s, 30s]` per capture → `MAX_RETRIES=3` exceeded → sidecar marked `upload_state: 'failed'`. By 02:49:05, ~52 captures had drained their retry budget while still offline.
4. By 02:49:06, the worker had stopped attempting new uploads (likely either the `@capacitor/network` plugin's offline event fired and gated the worker, or the failure rate prompted a self-throttle).
5. Captures 53–100 (02:49:06 → 02:49:41) were queued as `pending` without an immediate upload attempt.
6. Airplane mode OFF (~03:09 UTC, ~20 min later) → drain triggered → 48 `pending` uploaded cleanly to DB.
7. `failed` sidecars stayed in `failed` state (worker doesn't auto-retry failed items; requires manual retry from queue-sheet UI).

**Root cause:** The retry budget is not gated by network state. Captures taken during the first ~25 seconds of offline mode become permanent failures even though the offline condition is transient. The fix needs to: (a) detect known-offline state via the Network plugin before consuming retries, or (b) treat `"Load failed"`-class errors as transient and refuse to exhaust retries against them, or (c) hold captures in `pending` until network is up, regardless of `'65c-capture-written'` trigger.

**Recovery for the 52 stranded captures (Test 2):** The encrypted photos + sidecars are intact on Eric's iPhone. Once the fix lands, they can be recovered by:
- (a) Manual retry via long-press CaptureFab → upload-queue sheet → "retry all failed" (UI exists per `d0d2bca`/`1a1e8fe`), or
- (b) One-shot console reset: set `upload_state='pending'`, `retry_count=0`, then trigger `worker.drain()`.

**Disposition:** PR #52 **must NOT merge** until the network-gating fix lands. Pre-existing 65c plan's failure-path tests (Tests 3-5) become high priority — they would have caught this if run against true offline conditions rather than the synthetic-500 path.

### Finding C — Pre-65c "unknown" sidecars from another job (incidental, low priority)

On-device audit also found job `9d5e7fda-6073-43d7-a7fd-3618eeae673d` (a different test job, taken_at May 8/9 UTC) with **87 sidecars across 8 sessions, all in `upload_state: 'unknown'`** — i.e., the field is missing on the sidecar JSON.

This is **pre-65c data** — sidecars written before the upload_state field was added to the sidecar schema. The crypto-vault migration in plan Task 5 was supposed to handle pre-existing files (re-encryption); it appears either it didn't set `upload_state` on the migrated sidecars, or these specific sidecars predate even the migration coverage.

Implication: 87 captures on disk are invisible to the worker because `s.upload_state === 'pending'` filter in `drain()` excludes them. **Not data loss yet** (files still on disk) but invisible-to-queue.

**Disposition:** Not a 65c blocker per se, but worth a small migration extension: backfill `upload_state='pending'` on any sidecar where it's missing during `scanAll()`. Could land in the same fix-commit as Finding B's network-gating.

## Test-data carryover

- AAA prod `photos` table has **211 test photos** attached to job `0ccaacb2-98a5-45a5-9fce-98ce782b2bde` ("65c smoke 2026-05-09 Ndd", WTR-2026-0021, contact "65c smoke 2026-05-09 Ndd"). All `uploaded_from='mobile'`. Storage objects under `photos/{job_id}/...` paths.
- **52 stranded `failed` sidecars on Eric's iPhone** for the same job, session `dea218ba-...`, encrypted blobs intact — recoverable post-fix.
- **87 stranded `unknown`-state sidecars on Eric's iPhone** for separate job `9d5e7fda-...` (Finding C) — pre-65c data, recoverable post-migration-backfill.
- **Cleanup deferred** to Task 17 pre-merge. Job itself is a test job — safe to delete row + cascaded photos + storage objects together. Vanessa may create additional test jobs during continued smoke.

## Tests still unrun

- **Test 3-5 (failure-path).** Synthetic 500 via `/api/test/photo-upload-fail` + `localStorage['65c-force-upload-fail']='1'`; verify retry-budget exhaustion + visible failed-state in queue sheet. **Now high priority** — Finding B revealed that real offline behavior was never exercised pre-merge; the synthetic-500 path tests retry exhaustion against a *responding* server, not the WKWebView `"Load failed"` shape.
- **Test 6 (force-quit recovery).** Capture batch, kill app, relaunch; verify queue resumes via `scanAll()` on `UploadQueueProvider` mount.
- **NEW — Test 7 (true offline, post-fix).** With network-gating fix in place: airplane on, snap 50, wait, airplane off; verify all 50 land. Without this test, regression risk is high.

## Source

- Spec: [docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md](../../../docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md)
- Plan: [docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md](../../../docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md)
- PR #52: https://github.com/ericdaniels22/Nookleus/pull/52
- Branch: `build-65c-upload-pipeline`
- Last commit (pre-finding-investigation): `3ece2b1` (vault handoff for Test 2 findings)
- Migration: `build65c_photos_mobile_fields` (applied to AAA prod `rzzprgidqbnqcdupmpfe` during impl session)
- Handoffs: [[2026-05-08-build-65c-spec-and-plan]], [[2026-05-09-build-65c-impl-tasks-14-15-partial-16]], [[2026-05-09-build-65c-test-2-findings]]
