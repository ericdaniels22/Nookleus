# Build 65 — Mobile Platform via Capacitor (iOS-first)

**Status:** DRAFTED 2026-04-26 — pre-execution
**Drafted:** 2026-04-26
**Depends on:** Build 64 (handle_new_user trigger restoration — must ship first so crew can be invited)
**Precedes:** Phase 3 work (full crew mobile app, scheduling/dispatch), Phase 5 SaaS multi-tenant
**Sub-builds:** 65a → 65b → 65c → 65d → 65e (ordered, gated)
**Timeline:** 6–8 weeks to crew using it; App Store live by week 8–10
**Apple Developer Program:** Not yet enrolled — start in parallel during 65a (~24 hr enrollment, $99/yr)

---

## 1. Context & Goals

AAA's photo-capture workload is the platform's most-used feature in the field, and it's currently the worst on mobile. Crew today: open Safari → log into the platform → pinch-zoom into the photo upload modal → tap-and-hold to choose the system camera → snap a photo → wait for the iOS Photos roll to commit → upload from the file picker → tag → repeat. Friction at every step. Volume target is 100–500 photos per job; the current path doesn't survive volume.

**Build 65 ships a native iOS shell around the existing Next.js app** so crew can open one app, hit a floating action button on a job's detail page, and stay in a custom camera UI shooting photos at native frame rates. Photos sync silently in the background to the existing `photos` table tied to the active `job_id`. Once synced, every existing platform feature — annotation editor, before/after pairing, photo reports, the global photo dashboard — works on those photos automatically.

**Why Capacitor over React Native:** the entire codebase, every component, every API route, every Supabase query — that's months of work re-platforming. Capacitor wraps the existing Next.js bundle in a native iOS shell. The web layer keeps working as-is; only the camera flow is custom-native. That's the right tradeoff for this stage.

**Why iOS-first, not Android:** Eric's crew is on iPhones. Wife's Mac is borrowable for the heavy weeks. Apple Developer Program is the gating credential. Android can be built later by re-running the Capacitor scaffold with `@capacitor/android`; the codebase doesn't change.

### What Build 65 ships

- **65a — Capacitor scaffolding.** Native iOS project structure, Capacitor config, build pipeline, Xcode project verifiable on Mac. Web app loads in iOS WebView, navigation works, auth works, deep links work.
- **65b — Custom camera UI.** Stay-in-capture flow on `@capacitor-community/camera-preview`. Rapid mode (snap-and-stay) and tag-after-capture mode (snap-pause-tag-resume), toggle persists per session. Floating action button on `/jobs/[id]`. Post-session review screen.
- **65c — Upload pipeline + offline queue.** App-private sandboxed local storage encrypted at rest, aggressive background upload to Supabase Storage, sync indicator UI, auto-delete after sync. Capture works fully offline; queue drains when signal returns.
- **65d — Mobile-responsive audit.** Sweep of every page/component touched in the app shell — sidebar, job detail, intake, photos, contacts, email, settings — for sub-iPhone-15-Pro viewport readability. No new features; just fixes wherever the WebView reveals something broken on a 393pt-wide canvas.
- **65e — App Store submission.** Apple Developer enrollment, app icon, splash screen, screenshots, App Store Connect listing, TestFlight beta, App Review submission, public launch.

### What Build 65 does NOT ship

- **Android.** Future build; same Capacitor codebase, separate scaffolding pass.
- **Crew permission tightening.** Today every authenticated user can see all of AAA's data via the JWT-based RLS. The mobile experience inherits this. Per-crew permission scoping is Phase 3 / Build 14d enhancement, not 65.
- **Native annotation editor.** Existing Fabric.js editor works in the iOS WebView; it's been hardened for touch. Adding a native annotation surface is future polish, not v1 scope.
- **Native scheduling/dispatch UI.** Phase 3 territory.
- **Push notifications.** Possible Phase 3 add-on; the Build 14g notification system is in-app only for v1 mobile.
- **Voice notes / video.** The schema supports `media_type = 'video'` already; the v1 camera ships photo-only. Video is a possible 65b stretch but not commitment.
- **Background location, geofencing, biometric login.** None for v1.

---

## 2. Non-Goals

Out of scope for Build 65 entirely:

- **Re-platforming any web feature.** If a feature works in the desktop browser, the iOS WebView gets it for free. If it doesn't work in the WebView, it's a 65d fix or a deferral, not a rewrite.
- **Multi-tenant org switching from mobile.** The desktop workspace switcher (build62/62b) works in the WebView. No native menu replacement.
- **Native Stripe payment collection.** The `/pay/[token]` flow is web-based and works for customers regardless of device. Crew don't initiate payments from mobile in v1.
- **Native PDF rendering for reports.** Reports view in the WebView via the existing `@react-pdf/renderer` pipeline.
- **Custom keyboard, custom alerts, custom file picker.** Stock iOS components everywhere except the camera.
- **Crew onboarding flow.** Crew get invited via `/settings/users` (post-Build-64), accept via email, set their password, then download the app. No in-app sign-up.

---

## 3. Current State (Ground Truth, verified 2026-04-26)

### 3.1 Repo state

- **Latest commit on `main`:** `5eedd76` — "session-c(18c): build62/62b applied + build63 forward-fix, smokes PASS, handoff written"
- **Multi-tenant infrastructure (18a/b/c):** Complete. 56 tenant_isolation policies, custom access token hook, workspace switcher live.
- **Build 64 status:** Drafted 2026-04-26, not yet applied. **Build 65 must not start until Build 64 ships** — crew onboarding requires the invite trigger.

### 3.2 Photos table — current schema (verified)

```sql
public.photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),  -- added in 18a
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  annotated_path text,
  thumbnail_path text,
  caption text,
  taken_at timestamptz,
  taken_by text NOT NULL DEFAULT 'Eric',
  media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo','video')),
  file_size integer,
  width integer,
  height integer,
  before_after_pair_id uuid REFERENCES photos(id),
  before_after_role text CHECK (before_after_role IN ('before','after')),
  created_at timestamptz NOT NULL DEFAULT now()
)
```

The schema works for mobile photos as-is. No structural changes required for 65. Two small additions land in 65c (see §5.3).

### 3.3 Photo upload pipeline (web baseline)

- Source: `src/components/photo-upload.tsx` (377 lines)
- Path convention: `{organization_id}/{job_id}/{timestamp}-{rand6}.{ext}` in Supabase Storage bucket `photos`
- INSERT carries `organization_id` explicitly (per Build 18a/b multi-tenant requirements)
- `taken_by` defaults to the literal string "Eric" — needs to be parameterized in 65c (see §5.3)
- No thumbnail generation today — the `thumbnail_path` column exists but is unused. **Defer to 65c stretch goal.**

### 3.4 Mobile responsiveness — current state

Audit of the existing codebase via `grep` for responsive Tailwind breakpoints (`sm:`, `md:`, `lg:`):

- `src/components/job-detail.tsx` (1,729 lines): uses `sm:flex-row`, `lg:grid-cols-[1fr_1px_1fr_1px_1fr]`, `hidden lg:block`. Three-column layout collapses to single column at < `lg` (1024 px). Acceptable starting point for mobile but cards may stack awkwardly at 393pt width.
- `src/components/job-photos-tab.tsx` (535 lines): uses `aspect-square` photo grid; works fine on mobile in principle but the filter sidebar uses `min-w-[180px]` dropdowns that may overflow on iPhone.
- `src/components/photo-upload.tsx` (377 lines): drag-and-drop UI that's irrelevant on mobile — the floating action button + camera flow in 65b replaces this entry point. Existing modal kept for fallback.
- `src/components/nav.tsx`: Sidebar with mobile-menu toggle already exists. Confirmed responsive.

**No formal mobile audit has been done.** 65d's whole purpose is to do that audit systematically against a live iPhone, not just `grep`.

### 3.5 What's already mobile-ready vs what isn't

| Surface | Web works on iPhone Safari? | iOS WebView ready? |
|---|---|---|
| Login (email + password) | Yes | Yes — Capacitor passes through |
| Sidebar nav (mobile menu toggle) | Yes | Yes |
| Jobs list | Yes | Yes |
| Job detail | Mostly — three-column collapses awkwardly | 65d audit |
| Photo grid | Yes | Yes |
| **Photo upload (drag-drop modal)** | **Bad UX on mobile** | **Replaced in 65b** |
| Annotation editor (Fabric.js) | Confirmed touch-working from prior chat | Yes |
| Email inbox | Cramped at < 768px | 65d audit |
| Settings pages | Mixed | 65d audit |
| Customer-facing /sign and /pay | Light-themed, already mobile-tuned (Build 15/17) | Out of scope (web only) |

### 3.6 Eric's dev environment (locked decisions from 2026-04-25 chat)

- **Windows laptop** is primary. Capacitor's CLI runs on Windows for build/sync of the web bundle into the iOS project.
- **iPhone** (model TBC, on iOS-current as of April 2026). This is the test device throughout.
- **Wife's Mac** is borrowable for the heavy weeks: 65a startup, 65b camera build/test, 65e App Store submission. Roughly 4 weeks intermittent borrow. Xcode and `pod install` and Apple's signing pipeline all require macOS.
- **No Apple Developer Program enrollment yet.** Eric must enroll in parallel with 65a — the verification process can take 24h–7 days, and TestFlight + App Store both require it. **This is a critical-path dependency for 65e and a soft dependency for 65b (you can run unsigned builds on a personal device for development without enrollment, but only for 7 days at a time).**

---

## 4. Lessons from 18a/18b/18c applied here

### 4.1 Real-device verification, not simulation

The 18-series lesson — "compilation passing isn't the same as the change working end-to-end" — applies hard to mobile. Building a Capacitor iOS project that compiles and runs in the iOS Simulator is **necessary but not sufficient**. The Simulator doesn't have a real camera (it returns black frames or a placeholder), doesn't model real cellular drop-outs, doesn't reproduce the iOS Photos sandbox boundary, and doesn't enforce real signing. Every sub-build that touches camera, storage, or networking has to verify on a real iPhone, not just the Simulator.

**Build 65 response:** every sub-build's verification step explicitly requires "tested on Eric's physical iPhone, build signed via Eric's developer account, app launched from Home Screen." Simulator-only verification is insufficient.

### 4.2 Three-session protocol where it earns its keep

The 18-series A/B/C protocol existed because production schema/RLS changes are unrecoverable if wrong. For mobile work, the analog risk is "I shipped a build that bricks on real devices." Two sub-builds clear that bar:

- **65b (camera UI):** The capture loop is the most failure-prone surface — battery drain, WebView/native bridge stalls, file-system permissions, camera permission popups firing at the wrong time. Three sessions: A drafts the integration against scratch Supabase + simulator, B rehearses against a real iPhone pointed at scratch (not prod), C rolls to crew via TestFlight.
- **65c (upload pipeline + offline):** Data integrity surface. A drafts the queue + encryption + retry logic, B rehearses with airplane-mode toggling and forced network failures against scratch, C rolls to prod.

The other three (65a, 65d, 65e) don't earn the protocol overhead — they're either single-session mechanical work (65a, 65e) or a sweep across many small unrelated fixes (65d).

### 4.3 Public-facing audit is first-class

18c's lesson was that public routes get ignored in a build that's "about authenticated users." The mobile analog: **the App Store reviewer is a public visitor.** They don't have a real AAA account. The app has to handle "not logged in" gracefully — login screen, no scary errors, a clear path to "request access" or a polite "this app is for AAA Disaster Recovery employees" splash. 65e's deliverable list includes this.

### 4.4 Rule C hybrid gating works — keep it

Same minor-proceeds, material-stops adjudication on every sub-build that uses the three-session protocol.

### 4.5 Settings over code (SaaS Readiness Principle 2)

The mobile surface inherits the multi-tenant story automatically because every photo INSERT carries `organization_id` from `getActiveOrganizationId(supabase)`. **Don't introduce any AAA-specific hardcoding in the iOS shell** — bundle id, app icon, splash screen all parameterized so a Phase 5 white-label rebuild doesn't have to change Capacitor config or asset paths beyond the org-specific assets.

---

## 5. Sub-Build Decomposition

### 5.1 — Build 65a — Capacitor scaffolding (single session)

**Goal:** A native iOS project that loads the existing Next.js app inside a WebView, runs on Eric's iPhone (signed via developer account), survives logout/login, and deep-links into a job detail page. No new features. No camera. Prove the bridge works.

**Sessions:** Single session. Mechanical.

**Deliverables:**

- `npm install @capacitor/core @capacitor/cli @capacitor/ios` and run `npx cap init` with bundle id (suggestion: `com.aaacontracting.platform`). Bundle id is permanent — doesn't change in 65e.
- `capacitor.config.ts` — initial config. Server URL points at the production Vercel URL for v1 (live web bundle, not bundled-static; rationale below).
- `ios/` directory generated by `npx cap add ios`. Committed to repo.
- `npm run build && npx cap sync ios` works on Eric's Windows laptop. **The sync step doesn't require a Mac** — it copies the web bundle into the iOS project. Only opening Xcode and signing requires the Mac.
- Run on Mac: `npx cap open ios`. Xcode launches the project. Wire up Eric's free Apple ID (works without paid Developer Program) for 7-day signed dev builds. Run on Eric's iPhone, plugged in, USB-trusted.
- App icon stub (placeholder — final asset comes in 65e). Splash screen stub.
- Deep link config: `capacitor://localhost/jobs/<id>` opens the right route. Test by tapping a Vercel URL `aaaplatform.vercel.app/jobs/<id>` in iOS Mail or Messages — should give "Open in app" option.
- Logout flow works inside WebView. Login flow works. Workspace switcher works.
- iOS-specific stylesheet hook (`@supports (-webkit-touch-callout: none)`) for Capacitor-only CSS overrides if needed.

**Architectural decision: live web bundle vs bundled-static.**

Two choices for what the WebView loads:

- **(A) Live web bundle:** `capacitor.config.ts` has `server.url = 'https://aaaplatform.vercel.app'`. App loads the Vercel deploy. Updates to the web app are immediate; no App Store re-submission. **Risk:** iOS WebView caching can cause stale loads; cellular networks can stall the entire app on cold launch.
- **(B) Bundled-static:** Web bundle is built into the iOS .ipa. App loads `capacitor://localhost/...`. Updates require re-submitting to App Store. **Benefit:** offline-resilient cold launch, faster first paint, no Vercel dependency. **Cost:** every web change ships through the App Store (can take 24–48h).

**Locked decision: start with (A) for 65a/b/c development, evaluate switching to (B) in 65e.** Live bundle is dramatically faster to iterate on. Once the camera + upload pipeline is stable, the static-bundle option becomes attractive for App Store stability. 65e §10 reconsiders.

**Verification:**

1. Eric installs the dev build on his iPhone via Xcode + USB
2. Logs in
3. Navigates to a job detail page
4. Logs out
5. Tested on Eric's actual iPhone, not just Simulator
6. App icon visible on Home Screen
7. App survives going to Home and reopening (state preservation)
8. Workspace switch works mid-session

**Risks & mitigations:**

- **Risk: WebView storage isolation breaks Supabase auth cookies.** Mitigation: verify `localStorage` and `Cookie` API both work in WebView; Capacitor's `WebView` config accepts them by default but worth confirming.
- **Risk: Apple ID free-tier signing limits dev builds to 7 days.** Mitigation: enroll in Apple Developer Program in parallel; 7 days is enough for 65a verification but not for 65b's camera-iteration weeks.

**Single-prompt execution:** see §11.1.

---

### 5.2 — Build 65b — Custom camera UI (three sessions A/B/C)

**Goal:** A floating action button on `/jobs/[id]` opens a custom full-screen camera UI. Snap photos rapidly. Choose between rapid mode (snap → stay in capture) and tag-after mode (snap → pause for caption/tag → resume). Toggle in top corner, persists per session. Post-session review screen at end-of-capture for bulk-delete, bulk-tag, bulk-caption. Captured photos go into local sandboxed storage (handed off to 65c for upload).

**Sessions:** Three (A/B/C — protocol earns its keep here).

#### 5.2.A — Session A: Preparation

Author the camera shell against Eric's scratch Supabase project. No prod touches.

- `npm install @capacitor-community/camera-preview` and link in iOS project
- Update `Info.plist` for `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` (mic for video stretch goal — declared even if unused, so we don't have to re-submit to App Review later)
- New Next.js route: `src/app/(mobile)/jobs/[id]/capture/page.tsx`. Capacitor-detected only — desktop browser shows fallback "Use the upload modal on the job detail page."
- Custom UI: shutter button, mode toggle (rapid vs tag-after), front/back camera toggle, flash toggle, capture counter, "Done" button
- Floating action button on `/jobs/[id]` — visible on mobile/Capacitor only. Hidden on desktop. Lives in `src/components/job-detail.tsx`.
- Post-session review: grid of just-captured thumbnails; tap to expand, swipe to delete, batch tag/caption.
- Persist mode toggle in `localStorage` (`mobile-capture-mode`).
- Hand-off interface to 65c: capture writes to `LocalForage` (or Capacitor `Filesystem` API) under a specific key prefix `pending-uploads/{job_id}/{capture_session_id}/...`. Each capture is a `Blob` plus metadata sidecar. 65c reads from this key prefix.

**Verification step:**

- Real device test: Eric's iPhone, signed via dev account, hit the FAB on a job, capture 20 photos in rapid mode, capture 5 in tag-after mode, review/delete on the review screen, "Done" returns to job detail page. 25 photos in `pending-uploads/...` keys. Check via JS console hook (in dev only) — won't be there in production.
- Battery drain check: capture 100 photos in rapid mode; confirm device temperature and battery drop are reasonable (not "phone is hot, battery dropped 20%" — that's a Rule C material finding).
- Permission flow: first-launch capture should trigger the iOS camera permission popup; deny path must show a clear "Camera permission required" screen with a deep link to iOS Settings.

**Output:** `docs/superpowers/build-65/65b-session-a-handoff.md` with full pre-state, code-sweep notes, real-device test outcomes.

**Branch:** `65b-camera-prep`. No merge to main.

#### 5.2.B — Session B: Scratch rehearsal

Drive every UX path against scratch Supabase, real iPhone, real network, no prod data.

**Smoke tests:**

| Test | Expected | Failure means |
|---|---|---|
| FAB visible on `/jobs/[id]` on mobile, hidden on desktop | yes | viewport detection broken |
| Tap FAB, full-screen camera opens with shutter, flash, mode toggle | yes | shell incomplete |
| Rapid mode: tap shutter → still in camera, ready for next | yes | mode toggle not honored |
| Tag-after mode: tap shutter → caption/tag overlay → "Continue" returns to camera | yes | mode toggle not honored |
| Mode toggle persists across capture sessions on same device | yes | `localStorage` not wired |
| 100 captures in rapid mode, no crashes | yes | memory pressure / leak |
| Battery drain in 100-capture rapid session ≤ 5% | yes | inefficient capture loop |
| Phone temperature stays comfortable | yes | unsafe — Rule C material |
| Capture 50 photos in tag-after, all metadata persists | yes | sidecar write broken |
| Review screen: delete 5 photos, batch-tag 10, captions stick | yes | review state incomplete |
| Camera permission denied path shows a clear recovery screen | yes | UX hole |
| Switch front/back camera mid-session | yes | mode bug |
| App backgrounded mid-capture, foregrounded later: pending captures preserved | yes | sandbox cleared on background |

Rule C: minor findings proceed with logging; material findings stop for Eric.

**Output:** `docs/superpowers/build-65/65b-session-b-rehearsal-report.md`

**Branch:** push to `65b-camera-prep`.

#### 5.2.C — Session C: Production apply

Merge `65b-camera-prep` → main; Vercel auto-deploys the web changes; new TestFlight build pushed. Eric installs the TestFlight build on his iPhone. Smoke tests against AAA prod data. Deploy to crew via TestFlight broader internal testing.

**Pause points:** Eric verifies on his real iPhone before approving merge. After merge + TestFlight, brief crew on the new flow (Slack/in-person), ask them to try in the field for 3–5 days, collect feedback through whatever channel works (in-person, Slack, dedicated form). Iteration during that window is a hot-fix path; significant changes are 65b.1 not 65b.

**Output:** `docs/superpowers/build-65/65b-session-c-handoff.md`. Mark 65b complete when Eric and at least one other crew member have used it on a real job for a real day.

#### Locked decisions for 65b

1. **Floating action button on job detail.** Not on the global photos page, not on the dashboard. Per yesterday's decisions.
2. **Stay-in-capture flow.** Not "snap one photo and return" — the whole point is bulk capture.
3. **Mode toggle in top corner.** Not in a settings menu. Persists per session.
4. **Tag-after pauses fully.** Not a tag-while-camera-still-running approach. Pause makes the metadata real.
5. **Post-session review BEFORE upload.** Crew get to bulk-delete junk shots before they sync. This is the primary friction-reducer over the current Safari workflow.
6. **No video in v1.** Mic permission declared in Info.plist anyway (for forward-compat) but UI is photo-only.
7. **Camera flow IS Capacitor-detected.** Desktop browsers fall back to the existing photo-upload modal. No conditional in the same component — separate route.

---

### 5.3 — Build 65c — Upload pipeline + offline queue (three sessions A/B/C)

**Goal:** Photos captured in 65b sync to Supabase Storage automatically. App-private encrypted-at-rest local storage; auto-delete from device after successful sync. Sync indicator UI. Capture works fully offline; queue drains when signal returns. Retries with exponential backoff. Net result: crew shoots 200 photos in a basement with no cell signal, drives back to the truck, photos appear on the platform.

**Sessions:** Three (A/B/C — protocol earns its keep here, this is the data-integrity surface).

#### Schema additions for 65c

These are the only schema changes Build 65 introduces:

- `photos.uploaded_from text` — values `'web'` or `'mobile'`. Default `'web'`. Helps Eric distinguish field-captured vs office-uploaded photos in reports / filters.
- `photos.client_capture_id text` — opaque client-side UUID generated at capture time. Used for **idempotency**: if a retry uploads a photo twice, the second INSERT collides on a partial unique index over `(organization_id, client_capture_id) WHERE client_capture_id IS NOT NULL` and the duplicate is silently skipped.
- Migration `build65c-photos-mobile-fields.sql` adds both columns + the partial unique index. Rollback file shipped.
- `photos.taken_by` already exists. **Pipeline must set it from the authenticated user's `user_profiles.full_name`**, not the literal "Eric" default. (This is a small bug in the existing web upload too — call it out as Rule C minor and fix in pass.)

#### 5.3.A — Session A: Preparation

- Build the upload manager service: `src/lib/mobile/upload-queue.ts`
  - Watches `pending-uploads/...` keys via Capacitor Filesystem
  - Reads the queue on app launch, on network state change (`@capacitor/network` plugin), on background-fetch wake (iOS background fetch — separate plugin)
  - Per-photo upload: read encrypted blob, decrypt, upload to Supabase Storage (existing path convention), INSERT photo row, INSERT tag assignments, decrypt local copy, delete local copy
  - Encryption at rest: AES-256-GCM via `@capacitor/preferences` for the key (which lives in iOS Keychain via `KeychainSwift`-like wrapper), `crypto.subtle` for the encrypt/decrypt of the file blob
  - Failure handling: 3 retries with exponential backoff (1s, 5s, 30s), then mark as "failed" and surface in the sync indicator UI
  - Sync indicator: badge on the FAB / header showing "X uploading", "X failed", "all synced". Tapping shows a queue UI with retry/delete-failed actions.
- Auth retry path: if upload fails with 401 (token expired), refresh session and retry once
- Background sync: `@capacitor/background-task` + iOS background-fetch entitlement so the app can finish a queue even while the user is in another app
- Authoring migration `build65c-photos-mobile-fields.sql` against scratch Supabase first
- Update web `photo-upload.tsx` to also write the new `uploaded_from = 'web'` column (small, in-pass)

**Verification step:**

- Real-device test, scratch Supabase: airplane-mode on, capture 20 photos, airplane-mode off, watch the queue drain. All 20 land in scratch's `photos` table within 60s.
- Encryption-at-rest verification: with airplane-mode on after capture, attempt to inspect the file via Files.app (iOS) — should NOT be visible (sandboxed) and even if accessed via Xcode, should be unreadable bytes (encrypted).
- Auto-delete: after a photo successfully uploads, confirm the local file is gone via `Filesystem.readdir`.
- Idempotency: simulate a retry by uploading the same `client_capture_id` twice; confirm only one row in `photos`.

**Output:** `docs/superpowers/build-65/65c-session-a-handoff.md`. Branch: `65c-upload-prep`. No merge.

#### 5.3.B — Session B: Scratch rehearsal

| Test | Expected | Failure means |
|---|---|---|
| Capture 50 photos with full signal, all upload within 5 min | yes | rate limit / parallelism wrong |
| Capture 100 photos in airplane mode, then enable network: queue drains | yes | watchdog/network listener broken |
| Failed upload (mock 500 from server) retries 3 times, then marks failed | yes | retry logic |
| Failed-marked photo can be manually retried from queue UI | yes | UI hole |
| Failed-marked photo can be deleted from queue UI without uploading | yes | UI hole |
| App killed mid-upload, reopened: pending queue is intact | yes | queue persistence |
| App backgrounded with queue pending: continues uploading via background-fetch | yes | iOS background config |
| Encrypted local file unreadable when device connected to Xcode | yes | encryption broken |
| Same `client_capture_id` uploaded twice: only one DB row | yes | idempotency index |
| `uploaded_from='mobile'` set correctly | yes | column not wired |
| `taken_by` set to authenticated user's full_name, not 'Eric' default | yes | hardcoded default leak |
| `organization_id` correctly set from active org claim | yes | mt regression |
| Photo appears in /jobs/[id] photos tab on web after upload | yes | end-to-end break |
| Photo appears in /photos global gallery | yes | global query broken |
| Photo annotation editor (web) works on mobile-uploaded photo | yes | path/blob format mismatch |
| Mobile-captured photo can be paired before/after on web | yes | feature regression |
| Photo report includes mobile-captured photo | yes | report query break |

**Critical:** verification at this stage MUST include "the rest of the platform works on mobile-captured photos." This is the moment to catch any "the path is different" or "the EXIF strip is missing" bugs.

**Output:** `docs/superpowers/build-65/65c-session-b-rehearsal-report.md`. Push to `65c-upload-prep`.

#### 5.3.C — Session C: Production apply

- Apply migration `build65c-photos-mobile-fields.sql` to prod via Supabase MCP
- Verify migration applied cleanly, partial unique index in place
- Merge `65c-upload-prep` → main, Vercel deploys, TestFlight pushes new build
- Eric installs TestFlight, captures photos against AAA prod jobs, confirms full pipeline
- Crew wave 1: Eric + one trusted crew member use it for a full week of real work. Volume target: 100+ photos uploaded across multiple jobs.
- Sync indicator UI confirmed visible and accurate; no orphaned local files; no orphaned cloud files; no duplicate rows.

**Output:** `docs/superpowers/build-65/65c-session-c-handoff.md`. 65c marked complete after one full week of crew use without major findings.

#### Locked decisions for 65c

1. **App-private sandboxed storage.** Photos do NOT appear in the iOS Photos roll. iOS Photos sync is explicitly disabled.
2. **Encrypted at rest.** AES-256-GCM with key in iOS Keychain. Even if device is jailbroken or grabbed, photos are unreadable without the app.
3. **Auto-delete after successful sync.** Crew don't carry around 500 unsynced photos for weeks. Storage hygiene is automatic.
4. **Aggressive background upload.** Use iOS background-fetch entitlement; don't make crew keep the app open to drain a queue.
5. **3-retry exponential backoff, then surface in UI.** Don't retry forever silently; don't fail without telling the user.
6. **Idempotency via `client_capture_id`.** No deduplication via hash or filename — UUIDs are simpler and don't have collision concerns.
7. **`uploaded_from` column on `photos`.** Useful for analytics, reporting, and future filters; trivial to add now, painful to add later.
8. **Existing platform features must work on mobile-captured photos.** This is a hard requirement, not a stretch goal. 65b's whole architecture (push to existing `photos` table) is what makes this free; 65c's verification proves it stays free.

---

### 5.4 — Build 65d — Mobile-responsive audit (single session)

**Goal:** Walk every page in the app on a real iPhone, log the breakages, fix them. No new features; just the punch list of "this is broken at 393pt width."

**Sessions:** Single session, but iterative — Eric runs the audit (he's the only one who knows what "looks wrong" actually means in the field), Claude implements the fixes, ship in a bundle.

**Pages / components to audit:**

- `/` (dashboard)
- `/jobs` (jobs list)
- `/jobs/[id]` (job detail — three-column layout collapse, especially)
- `/intake` (long form, mobile keyboard interactions)
- `/photos` (global photo grid)
- `/email` (inbox — known to be cramped at < 768px)
- `/contacts` (placeholder; just confirm doesn't break)
- `/reports` and report builder
- `/settings/*` — every settings sub-page
- `/sign/[token]` and `/pay/[token]` — already mobile-tuned (Build 15/17), verify no regression

**Per-issue path:**

1. Eric uses the app, finds a thing that's broken / cramped / unreadable
2. Screenshots and notes
3. Either (a) one-off fix per issue, single PR each, fast turnaround; or (b) batch them and ship a single PR. **Default: batch with sub-issue list in PR description.**
4. Verify on real device after each fix

**Locked decisions for 65d:**

1. **Real device, not Chrome DevTools mobile mode.** DevTools lies about iOS-specific font rendering, safe-area insets, and momentum scroll behavior.
2. **No new features.** If a fix would require a new feature, it's a separate build, not 65d.
3. **No CSS architecture refactors.** Tailwind utility tweaks only. If the fix requires touching `globals.css` or restructuring components, log it as Phase 3 polish, not 65d.
4. **Customer-facing routes (`/sign`, `/pay`) get verified, not redesigned.** They were tuned in Build 15/17 already.

**Output:** `docs/superpowers/build-65/65d-audit-report.md` — list of issues, fixes applied, and "wontfix-now" items deferred to Phase 3.

**Verification:** all logged issues either fixed or explicitly deferred with rationale. Final round on Eric's iPhone.

---

### 5.5 — Build 65e — App Store submission (single session, admin-heavy)

**Goal:** AAA Disaster Recovery is live in the App Store. Crew can search and install. Eric controls release via App Store Connect.

**Sessions:** Single session of build/submit work; review wait is 24h–7 days outside the session.

**Deliverables:**

1. **Apple Developer Program enrollment.** $99/yr. Started at the beginning of 65a; should be active well before 65e starts. If not, this is the blocker — wait it out.
2. **App icon.** 1024×1024 master, plus all required iOS sizes. Per SaaS Readiness Principle 1, the icon should be the AAA logo, parameterized — Phase 5 white-label rebuilds swap this single asset.
3. **Splash / launch screen.** Per `Info.plist` LaunchScreen.storyboard.
4. **App Store Connect listing:** name, subtitle, description, keywords, support URL, privacy policy URL (must exist publicly — can host on aaacontracting.com or in-platform), category (Business), pricing (Free), age rating (4+).
5. **Screenshots.** 5–10 screens per device size required (6.7" iPhone Pro Max minimum). Take from real app on a real iPhone, not Simulator. Cover: jobs list, job detail, photo capture, photo review, photo gallery.
6. **Privacy nutrition label.** Apple's "what data your app collects" form. AAA collects: contact info (employee email), photos (work-related only, app-private), location (none), identifiers (org_id, user_id). Honest filing; no dark patterns.
7. **App Privacy Policy.** Hosted publicly. Can be a simple page on aaacontracting.com.
8. **Sign-in demo account.** App Review needs a working test login. Create a dedicated `appreview@aaacontracting.com` account in TestCo (NOT AAA) with limited test data so reviewers can navigate without seeing real customer data. This is exactly what Build 18c made possible.
9. **TestFlight beta.** Push the build through TestFlight first; internal team (Eric + 1–2 crew) tests. After internal sign-off, expand to "external testing" if needed (requires App Review of the beta build, which is faster than full App Store Review).
10. **App Store Review submission.** Submit. Wait. Address feedback.
11. **Public launch.** Manually release once approved. Eric controls timing.

**Architectural decision check:** at start of 65e, reconsider live-bundle-vs-static (§5.1's locked decision). After 65b/c ship and the camera flow is stable, **switching to bundled-static for App Store builds may be the right call.** Reasons:
- App Review is more predictable when the app doesn't depend on a remote server response on first launch
- Cold launch is faster
- A Vercel outage doesn't brick the app
- Reviewers test with bad networks; bundled-static doesn't fail those tests
- **Cost:** every web change ships through App Store re-submission

**Recommendation: bundle-static for App Store, keep live-bundle for TestFlight dev/beta builds.** Capacitor supports this via per-config-target. Two bundle targets, same codebase.

**Locked decisions for 65e:**

1. **Public price: free.** App is internal-use for AAA crew. Phase 5 might revisit this for SaaS but not 65.
2. **Distribution: public App Store.** Not Enterprise distribution, not Ad Hoc. Public listing makes onboarding new crew trivial (search + download); the app's own login gate handles authorization.
3. **App Review demo account in TestCo, not AAA.** Tests the multi-tenant story by exercising the workspace switcher in front of reviewers. Bonus: doesn't expose AAA's real customer data to App Review.
4. **App icon = AAA logo for v1.** White-label parameterization is Phase 5 work; for now ship AAA.
5. **iOS only for v1.** Android is a future build using the same Capacitor codebase.
6. **Reconsider live-bundle vs static-bundle at 65e start.** Locked decision in 65a is provisional; may flip here.

**Output:** Public app in the App Store. `docs/superpowers/build-65/65e-app-store-submission-log.md` with submission timeline, review feedback, resolution.

---

## 6. Cross-Cutting Concerns

### 6.1 Apple Developer Program enrollment (parallel critical-path item)

**Start: today (2026-04-26).** Enrollment can take 24h–7d. Without it, 65e blocks; with it active by week 4–5, Eric can start TestFlight beta in 65b/c. Cost: $99/yr.

Eric's tasks (no dev work involved, ~30 min):

1. Apple Developer site → Enroll → "Individual" or "Organization" account
2. **Choose Organization** if AAA Disaster Recovery has a DUNS number or can get one (free). Org enrollment is required for some App Store listing fields and looks more legitimate to customers.
3. Verification: Apple may call to verify, may require D-U-N-S confirmation
4. Once active: log into App Store Connect, accept the developer agreement

### 6.2 Mac access during heavy weeks

Estimated borrow weeks: **65a (1 week startup), 65b (2–3 weeks for camera iteration), 65c (1 week for upload pipeline real-device testing), 65e (1 week submission window). ~5 weeks intermittent.**

Eric should:

- **Front-load the Mac-required work into focused chunks.** Don't try to do "5 minutes on the Mac per day for 30 days" — borrow the Mac for a Saturday, do all the Xcode/signing/build work for the week, hand it back.
- **Use Capacitor's CLI on Windows for everything possible.** `npm run build && npx cap sync ios` works on Windows; only `npx cap open ios` and the Xcode/signing steps need Mac.
- **CI/CD on macOS via GitHub Actions** is a future investment (post-65e) that would eliminate the Mac-borrow dependency. Not in 65 scope.

### 6.3 Test users / TestCo seeding

After Build 64 ships, AAA has the trigger restored and can invite real crew. For Build 65, we need **a dedicated mobile-test account separate from Eric's primary account** so testing doesn't pollute AAA's real photo gallery.

- Create `eric+mobile-test@aaacontracting.com` invited to AAA as crew_member role
- Use this account for all 65b/c session-A/B testing
- **Do NOT use it on prod runs** — it's for scratch only. Production session-C testing uses Eric's real account on real jobs.
- For 65e App Review demo: separate dedicated account in TestCo (per §5.5 locked decision).

### 6.4 Branch strategy

Following the 18-series pattern:

- One feature branch per sub-build: `65a-scaffold`, `65b-camera-prep` → `65b-camera`, `65c-upload-prep` → `65c-upload`, `65d-mobile-audit`, `65e-appstore`
- Sub-builds with three-session protocol use `-prep` for sessions A/B and rename / re-merge for session C
- All merges go to `main`, Vercel auto-deploys, TestFlight builds triggered manually post-merge
- No long-lived release branch. Tag releases via GitHub Releases for App Store version correlation.

### 6.5 Versioning

Capacitor / iOS versioning is independent of platform feature versioning. Suggested scheme:

- `CFBundleShortVersionString` (display version): `0.1.0` for 65a/b/c testing, `1.0.0` for 65e public launch
- `CFBundleVersion` (build number): monotonic integer, increment per TestFlight or App Store push
- Tag git releases as `mobile-v0.1.0`, `mobile-v1.0.0`, etc., distinct from platform tags

---

## 7. Migration Plan

Build 65 introduces **one** schema migration (in 65c):

- **build65c — `photos` mobile fields.** Adds `uploaded_from text DEFAULT 'web'` and `client_capture_id text`. Adds partial unique index `photos_client_capture_id_uniq ON photos(organization_id, client_capture_id) WHERE client_capture_id IS NOT NULL`. Rollback file ships alongside.

No other migrations. Builds 65a/b/d/e are app-code-only.

---

## 8. Locked Decisions (Build-Wide)

These apply across all sub-builds and should NOT be reconsidered without explicit re-approval:

1. **Capacitor over React Native or full native.** Decided 2026-04-25.
2. **iOS first, Android later.** Same codebase reused; no rewrite.
3. **Photos go directly into existing `photos` table tied to `job_id`.** No separate mobile silo.
4. **App-private sandboxed storage, encrypted at rest.** Photos invisible in iOS Photos roll.
5. **Auto-delete after sync.** Local storage doesn't accumulate.
6. **Stay-in-capture UX with rapid/tag-after toggle.** Persists per session.
7. **Floating action button on `/jobs/[id]` only.** Not global. Can extend later.
8. **Post-session review for bulk-tag/caption/delete.** Critical friction-reducer.
9. **Offline-resilient with queued sync indicator.** Crew never block on signal.
10. **Existing platform features (annotation, before/after, reports, gallery) work on mobile-captured photos automatically.** Hard requirement; 65c verifies.
11. **Volume target: 100–500 photos per job.** Sets the upload-pipeline performance bar.
12. **Sub-build sequence: 65a → 65b → 65c → 65d → 65e.** Each gates the next.
13. **Three-session protocol for 65b and 65c only.** 65a/d/e ship single-session.
14. **Apple Developer enrollment starts today (2026-04-26), in parallel with 65a.**
15. **Bundle id: `com.aaacontracting.platform`.** Permanent; doesn't change.
16. **Live web bundle in 65a/b/c development; reconsider static-bundle in 65e.**
17. **No video, no biometrics, no push notifications, no native scheduling in v1.**
18. **Build 64 ships before Build 65a starts.** Crew onboarding requires the trigger.
19. **No AAA-specific hardcoding in iOS shell** (per SaaS Readiness Principle 1). White-label rebuild for Phase 5 is a config + asset swap.
20. **Rule C hybrid gating governs every sub-build.**

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Apple Developer enrollment delayed beyond 65a end | Med | Blocks 65e | Start today; 7d worst-case fits inside 65a/b timeline |
| WebView Supabase auth-cookie regression | Low | Blocks all of 65 | Verify in 65a session; fall back to in-WebView token-refresh tweaks |
| iOS background-fetch entitlement denied at App Review | Low | 65c needs adjustment | Have polling-on-foreground as backup behavior |
| Crew finds tag-after mode disruptive in real use | Med | UX iteration during 65b session C | Rapid-mode is the default; tag-after is opt-in. Acceptable degraded UX. |
| Camera memory leak on iPhones older than spec | Low | Battery/heat issue for some crew | Document min-supported iOS version in App Store listing; 65b smoke tests catch the obvious cases |
| Vercel outage during App Review with live-bundle config | Low | App Review fails | 65e flips to bundled-static for App Store builds |
| Photos table volume scaling | Low | Storage bill creeps | Existing schema handles; storage cost only matters at multi-org scale, deferred to Phase 5 |
| Mac borrow availability | Med | Slows 65b/c iteration | Front-load to weekend chunks; CI/macOS as future investment |
| Crew lose photos to local-storage corruption pre-sync | Low | Trust hit | Encrypted local storage + idempotency + retry queue mitigate; document the path "captured offline → device fully drains battery → next launch resumes queue" in 65c |
| App Review rejection on first submission | High | Adds 1–7d to 65e | Standard; budget for 1–2 review cycles. Common rejection reasons: missing privacy policy, broken demo account, unclear app purpose. All addressable in §5.5 deliverables. |

---

## 10. Success Criteria

### 65a complete when

- [ ] iOS project committed to repo at `ios/`
- [ ] `npm run build && npx cap sync ios` runs cleanly on Eric's Windows laptop
- [ ] Eric installs the dev build on his iPhone via Xcode
- [ ] Login, navigation, logout all work in the WebView
- [ ] Workspace switch works mid-session in WebView
- [ ] App icon and splash visible (placeholder OK at this stage)
- [ ] Deep link from URL opens the right route
- [ ] No regression on the desktop web app

### 65b complete when

- [ ] FAB visible on `/jobs/[id]` on mobile, hidden on desktop
- [ ] Custom camera UI captures photos in rapid + tag-after modes
- [ ] Mode toggle persists per session
- [ ] Post-session review screen works for bulk delete/tag/caption
- [ ] 100-photo capture session completes without crashes or excessive battery drain
- [ ] Camera permission denied path has a clear recovery screen
- [ ] Eric AND at least one other crew member have used it on a real job day

### 65c complete when

- [ ] `build65c-photos-mobile-fields.sql` applied on prod
- [ ] Upload queue drains automatically with full network
- [ ] Capture works fully offline, queue drains when network returns
- [ ] Photos auto-delete locally after successful upload
- [ ] Local storage encrypted at rest (verified via Xcode inspection)
- [ ] Idempotency: same `client_capture_id` uploaded twice → one DB row
- [ ] `uploaded_from = 'mobile'` set correctly
- [ ] `taken_by` reflects the authenticated user, not a hardcoded default
- [ ] Mobile-captured photos appear in /jobs/[id] photos tab on web
- [ ] Annotation editor (web) works on mobile-captured photos
- [ ] Before/after pairing works on mobile-captured photos
- [ ] Photo reports include mobile-captured photos
- [ ] Crew uses for one full week, 100+ photos uploaded, no major findings

### 65d complete when

- [ ] Every page in §5.4 audit list verified on real iPhone
- [ ] All "must-fix" issues resolved
- [ ] All deferred issues logged with rationale
- [ ] No regression on desktop web

### 65e complete when

- [ ] Apple Developer Program enrollment active
- [ ] AAA Disaster Recovery is publicly listed in the App Store
- [ ] Eric and at least one crew member have downloaded the public version
- [ ] App Review demo account works
- [ ] Privacy policy publicly hosted
- [ ] Privacy nutrition label filed honestly
- [ ] TestFlight build channel exists for future updates
- [ ] No major App Review issues outstanding

### Build 65 complete when

All five sub-builds complete and AAA crew is using the iOS app on real jobs as the primary photo-capture path.

---

## 11. Per-Sub-Build Execution Prompts

### 11.1 Build 65a single-session prompt

```
Build 65a — Capacitor scaffolding for AAA Platform iOS app.

Plan: docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md §5.1
Read in full before doing anything.

Pre-flight:
- Confirm Build 64 has shipped (trigger present, no orphan auth.users rows).
- Confirm Eric has Mac access this session and his iPhone available.
- Confirm Apple Developer Program enrollment status (pass-through OK if not 
  yet active — free Apple ID signing works for 7-day dev builds).

Branch: 65a-scaffold off main.

Apply (in order):
1. npm install @capacitor/core @capacitor/cli @capacitor/ios
2. npx cap init "AAA Disaster Recovery" "com.aaacontracting.platform" 
   --web-dir=out
3. capacitor.config.ts: server.url = "https://aaaplatform.vercel.app"
   (live-bundle, per §5.1 locked decision)
4. npx cap add ios
5. Author iOS app icon stub + splash screen stub
6. Configure Info.plist for capacitor-required entitlements
7. npm run build && npx cap sync ios on Windows — should succeed
8. On Mac: npx cap open ios. Wire Eric's Apple ID for free-tier signing.
9. Run on Eric's iPhone via USB
10. Smoke-test: login, navigate to a job, logout, deep-link, workspace switch
11. Commit ios/ + capacitor.config.ts to repo
12. Write docs/superpowers/build-65/65a-handoff.md
13. Merge 65a-scaffold to main; tag mobile-v0.1.0

Rule C: any material finding stops for Eric.
```

### 11.2 Build 65b prompts (A/B/C)

(Authored at Session A start, mirroring 18c §11 structure. Three prompts: Prompt A = camera shell against scratch, Prompt B = scratch rehearsal on real iPhone, Prompt C = production apply via TestFlight + crew rollout. Generated in detail at start of 65b, deferred from this plan to avoid wholesale copy-paste.)

### 11.3 Build 65c prompts (A/B/C)

(Same pattern. Generated at start of 65c.)

### 11.4 Build 65d single-session prompt

```
Build 65d — Mobile-responsive audit of AAA Platform.

Plan: §5.4 of the 65 plan.

Eric drives the audit. He uses the TestFlight build (or current dev build) 
on his iPhone, walks every page in the §5.4 list, and screenshots every 
issue. Hands the screenshots + notes to Claude Code.

Claude Code's job:
1. For each issue: triage as "fix-now" or "defer-to-Phase-3".
2. Author Tailwind utility tweaks for fix-now items (no CSS architecture 
   refactors per §5.4 locked decision 3).
3. Verify on real iPhone after each fix.
4. Batch into a single PR with a sub-issue list.
5. Write docs/superpowers/build-65/65d-audit-report.md with deferred items 
   and rationale.

Rule C: any structural finding (would require a refactor to fix) stops 
for adjudication. Tailwind tweaks proceed.
```

### 11.5 Build 65e single-session prompt

```
Build 65e — App Store submission for AAA Disaster Recovery iOS app.

Plan: §5.5.

Pre-flight:
- Confirm Apple Developer Program enrollment is ACTIVE (this is the gating 
  prerequisite — if not active, stop and wait).
- Confirm 65a/b/c/d are all shipped and stable on TestFlight.
- Confirm Mac available for the duration of the submission session.

Apply (in order):
1. App icon final asset (1024×1024 + iOS sizes) using AAA logo
2. Splash screen final asset
3. Screenshots from real iPhone (5–10 per device size) — Eric drives, 
   takes screenshots, uploads to App Store Connect
4. Privacy policy hosted at aaacontracting.com/privacy or in-platform
5. App Store Connect listing: name, description, keywords, category 
   (Business), pricing (Free), age rating (4+)
6. Privacy nutrition label filed honestly per §5.5 deliverable 6
7. Reconsider live-bundle vs static-bundle (§5.5 architectural decision 
   check). If switching, update capacitor.config.ts and re-build.
8. Create App Review demo account in TestCo: appreview@aaacontracting.com 
   with limited test data
9. TestFlight internal testing one more pass
10. Submit to App Review
11. Wait. Address feedback.
12. Manually release to App Store once approved.
13. Write docs/superpowers/build-65/65e-app-store-submission-log.md

Rule C: any rejection that requires architectural change stops for 
adjudication. Documentation/asset/policy fixes proceed.
```

---

## 12. Phase 3 / Phase 5 Considerations Out of Scope Here

Build 65 is the foundation; future builds extend it.

### Phase 3 (post-65)
- Push notifications (job assigned, payment received, contract signed)
- Native annotation editor with iOS Pencil support
- Voice-note capture during photo session
- Background location for crew dispatch
- Native Stripe payment collection on the customer-facing /pay route
- Android via `@capacitor/android`
- Scheduling/dispatch native UI

### Phase 5 (post-Phase-3)
- White-label rebuild for SaaS customers (per Org-1 / Org-N white-label)
- Per-org bundle id, app icon, splash — driven by Capacitor target configs
- App Store Enterprise distribution if any SaaS customer needs internal-only deployment
- Evaluating a native rewrite (React Native or Swift UI) IF Capacitor's WebView limitations become severe at scale

---

## 13. What this build sets up well for Phase 3 and Phase 5

The Build 65 choices that matter for the future:

- **Capacitor over rewrite.** Phase 5 white-label is a config + asset swap, not a re-platform.
- **Photos in existing schema.** Annotation, reports, before/after — every existing feature scales to mobile-captured photos free of charge. No future feature has to handle "is this photo from web or mobile?" except for the explicit `uploaded_from` filter, which is opt-in.
- **App-private sandboxed storage with encryption at rest.** SOC 2 Type I (Phase 5) gets a head start: photos never leave AAA's control between capture and Supabase.
- **Bundle id permanence.** No App Store bundle-id migration ever (those are painful).
- **`uploaded_from` and `client_capture_id` columns.** Feature flags / analytics can lean on these; idempotency story extends to any future capture surface (Android, web upload from a different client, API import).
- **No AAA-specific iOS hardcoding.** When Phase 5 ships white-label, the iOS shell rebuild is a per-org asset bundle plus a Capacitor config swap, nothing else.

Build 65 also intentionally DOESN'T:
- Lock in a native annotation editor (Phase 3 add)
- Lock in iOS-only (Android in Phase 3)
- Lock in single-tenant (multi-tenant story already works via 18a/b/c)

---

## 14. Phase 5 followups not blocked by 65

These are SaaS-readiness items that are unrelated to mobile but worth tracking adjacent:

- Per-org email domain (Phase 5 §13 of 18c plan)
- Stripe Connect (Phase 5)
- Subscription billing (Phase 5)
- Self-service org signup (Phase 5)
- Per-org Resend account (Phase 5)
- Per-org App Store listing if white-labeling (Phase 5; app rebuild via Capacitor target swap)

None of these block Build 65 shipping.

---

*End of plan — Build 65 v1*
