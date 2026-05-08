# Build 65b Session A Handoff — 2026-04-29

**Status:** Path B (Windows-only, scratch-deferred) scaffold complete.
**Branch:** `build-65b-session-a` (worktree at `.claude/worktrees/build-65b-session-a`).
**Plan:** `docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md` §5.2.A.

## Path B re-scope (why this isn't full Session A)

The plan's Session A specifies "author the camera shell against Eric's
scratch Supabase project" with a real-iPhone verification step gated on Mac
access. Two pre-flight items weren't actually green at session start:

1. **No scratch Supabase project exists.** The platform runs on a single
   shared Supabase (`rzzprgidqbnqcdupmpfe`) where dev = prod. Standing up a
   scratch project + replaying every `supabase/migration-build*.sql` against
   it is real work that hadn't happened.
2. **No Mac in this session** — work happened on TheLaunchPad (Windows
   desktop). Step 9 of the prompt (Apple-ID-signed dev build, install via
   Xcode + USB) requires the Mac.

Eric chose Path B: do steps 1–8 of the prompt on Windows, with mocked
photo_tags reads in the review screen, and defer steps 9–10 to the next
Mac/iPhone session. tsc-clean is the strongest meaningful verification
available without a real device.

## What shipped in this session

### iOS native side

- **`ios/App/App/Info.plist`** — added `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription`. Mic declared even though video isn't in
  v1 scope (per plan §5.2.A; declaring up front avoids App Review
  re-submission if 65b's video stretch goal ever lands).
- **`npx cap sync ios` was NOT run.** The sync step requires Mac + Xcode
  to do its full work; running it on Windows only copies the web bundle.
  The Mac session must run `npx cap sync ios` before installing.

### Web shell

- **`src/lib/mobile/`** — new module for mobile-only code.
  - `capture-types.ts` — `CaptureMode` (`'rapid' | 'tag-after'`) and the
    `CaptureSidecar` JSON schema (see § "Hand-off contract to 65c" below).
  - `capture-storage.ts` — Capacitor `Filesystem` wrapper.
    `writeCapture`, `readSidecar`, `readPhotoDataUrl`,
    `listSessionCaptures`, `updateSidecar`, `deleteCapture`. All keyed
    against `Directory.Documents` (app-private sandbox).
  - `use-capacitor.ts` — `{ isNative, ready }` mount-aware hook around
    `Capacitor.isNativePlatform()`. Returns `ready: false` during SSR.
  - `use-capture-mode.ts` — localStorage-backed mode persistence under
    key `mobile-capture-mode`. Default `'rapid'`. Validates stored
    values before applying.
  - `mock-photo-tags.ts` — five mocked `PhotoTag` rows (Before, During,
    After, Damage, Equipment) so the review screen renders something
    reviewable without scratch Supabase. Real fetch from `photo_tags`
    wires up in the next Mac/iPhone session against scratch creds.
- **`src/app/(mobile)/jobs/[id]/capture/page.tsx`** — server component
  that awaits `params` (Next.js 16 convention) and hands `jobId` to the
  client orchestrator.
- **`src/app/(mobile)/jobs/[id]/capture/capture-flow.tsx`** — client
  orchestrator. Generates one `capture_session_id` UUID per flow,
  switches between camera step and review step, redirects desktop
  visitors to a fallback card, redirects native visitors back to
  `/jobs/<id>` on Save & exit / abort.
- **`src/components/mobile/camera-view.tsx`** — full-screen capture UI.
  - `CameraPreview.start({ position, parent: 'camera-preview-mount',
    toBack: true, ... })` mounts the native preview behind the WebView.
  - Top bar: cancel (X), mode toggle (Rapid / Tag after), flash cycle
    (off → auto → on).
  - Bottom bar: flip camera, shutter, Done (with capture counter).
  - Tag-after mode opens a bottom sheet with caption input + tag chips
    after each capture; "Continue" persists sidecar updates and resumes
    capture.
  - Permission-denied surface: replaces the camera UI with an
    instruction card pointing to iOS Settings → Nookleus → Camera.
- **`src/components/mobile/review-screen.tsx`** — post-capture review.
  - Thumbnail grid (3 columns, aspect-square).
  - Tap → expanded full-screen view with Delete button.
  - Swipe-left on a tile (≥80px) deletes that capture from Filesystem
    and re-renders.
  - "Select" toggle enters multi-select mode; footer surfaces
    Caption / Tag / Delete batch actions on the selected set.
  - Batch caption / batch tags use the intersection of existing values
    as the editor's starting state.
  - "Save & exit" returns to `/jobs/<id>`. "Camera" returns to capture
    flow with the same `capture_session_id` (additional shots land in
    the same directory, ready for 65c to pick up as one batch).
- **`src/components/mobile/capture-fab.tsx`** — Capacitor-detected FAB,
  hidden entirely on desktop (`return null` when `!isNative`). Linked
  via `next/link` to `/jobs/<id>/capture`.
- **`src/components/job-detail.tsx`** — single import + single
  `<CaptureFab jobId={jobId} />` render at the top of the main return.
  Component is `position: fixed` so JSX placement is purely a render
  trigger; no layout impact.

### Plan file the previous orient skill couldn't find

`docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md` had been
referenced from `docs/vault/builds/build-65a.md` but never committed.
Eric provided the file from his Downloads folder during this session;
it's now committed at the expected path. The file's appName text says
"AAA Disaster Recovery" throughout — the Nookleus rename (PR #38) shipped
afterwards and supersedes those references; otherwise the plan is still
authoritative for 65b–65e.

## Hand-off contract to 65c

This is the hard interface. Don't change without updating this section
and the plan §5.3.A.

### Filesystem layout

All paths are relative to Capacitor's `Directory.Documents`:

```
pending-uploads/
  {job_id}/
    {capture_session_id}/
      {client_capture_id}.jpg     # base64 JPEG written by writeCapture
      {client_capture_id}.json    # CaptureSidecar (UTF-8 JSON)
```

- `job_id` — UUID from the URL `/jobs/[id]/capture`. Same `job_id` used
  in the Supabase `photos` table.
- `capture_session_id` — UUID generated once per CaptureFlow mount.
  Re-entering capture mid-flow ("Camera" button on review screen) keeps
  the same session id so additional shots land in the same directory.
  Closing and reopening the capture flow generates a new session id.
- `client_capture_id` — UUID per shot. This is the same identifier 65c
  must use as the Supabase `photos.client_capture_id` value for the
  partial-unique-index idempotency story (per plan §5.3 locked
  decision 6).

### Sidecar JSON schema

```jsonc
{
  "client_capture_id": "uuid",       // matches the .jpg filename
  "job_id": "uuid",                  // mirrors the directory
  "capture_session_id": "uuid",      // mirrors the directory
  "taken_at": "2026-04-29T17:32:11.043Z",  // ISO 8601, local-clock at capture
  "capture_mode": "rapid",           // "rapid" | "tag-after"
  "width": 0,                         // TODO Session B: read EXIF before write
  "height": 0,                        // TODO Session B
  "orientation": 1,                   // TODO Session B
  "caption": null,                    // string | null
  "tag_ids": []                       // string[] of PhotoTag ids
}
```

Width / height / orientation are stubbed at `0 / 0 / 1` in Session A.
`CameraPreview.capture()` returns just a base64 string; reading EXIF
before write is a Session B follow-up. The sidecar shape is final, the
values for those three fields aren't.

### What 65c needs to do, top to bottom

1. On app launch / network event / background-fetch wake, scan
   `pending-uploads/**/*.json` via `Filesystem.readdir`.
2. For each sidecar, read the matching `.jpg` blob.
3. Encrypt the blob (AES-256-GCM, key in iOS Keychain) before sending —
   per plan §5.3 locked decision 2, the on-device file should already be
   encrypted at rest. **Session A writes plaintext.** This is a
   deliberate Session A → 65c gap; 65c's Session A will introduce
   encryption-at-rest as part of the upload-queue scaffolding.
4. POST to Supabase Storage at the existing path convention
   `{organization_id}/{job_id}/{timestamp}-{rand6}.{ext}`.
5. INSERT into `photos` with `client_capture_id`, `uploaded_from =
   'mobile'`, `taken_at`, `caption`, plus tag assignments per
   `tag_ids`. The partial unique index on `(organization_id,
   client_capture_id) WHERE client_capture_id IS NOT NULL` (added by
   `build65c-photos-mobile-fields.sql`) makes retries idempotent.
6. On 200, delete both the `.jpg` and the `.json` from Filesystem
   (plan §5.3 locked decision 3 — auto-delete after sync).

## Session A.5 update — scratch Supabase satisfied

Session A.5 (same branch, same date) satisfied the four scratch-related
deferred items from the original Path B handoff:

- [x] **Scratch Supabase project stood up + 53 migrations replayed.**
      Project `jpzugbioqdjhhmuwqqeg` / `aaa-platform-scratch-65b-2026-04-29`.
      See [`supabase/scratch-replay-notes.md`](../../../supabase/scratch-replay-notes.md)
      for the order, the build42 deviation (skipped Eric's prod user
      seed; replaced with the test user's membership in
      [`supabase/seed-scratch.sql`](../../../supabase/seed-scratch.sql)),
      and reproducibility steps.
- [x] **`.env.scratch.local` lives at repo root.** Gitignored
      (`.gitignore` line 36 `.env*`). Scratch URL + anon key +
      service_role key. Never committed; transferred out-of-band per
      "Mac session pre-flight" below.
- [x] **`MOCK_PHOTO_TAGS` replaced with org-scoped fetch.** New hook at
      [`src/lib/mobile/use-photo-tags.ts`](../../../src/lib/mobile/use-photo-tags.ts)
      handles loading + error states via the existing browser supabase
      client; RLS on `photo_tags` does the org-scoping per build49.
      Both `camera-view.tsx` and `review-screen.tsx` consume the hook.
      `mock-photo-tags.ts` is retained as a type fixture (one-line
      retention comment at the top); no longer imported anywhere in
      production paths.
- [x] **dotenv-cli wired** (`devDependency`, `^11.0.0`). All scratch-mode
      dev runs use:
      `npx dotenv -e .env.scratch.local -- npm run dev`
      `.env.local` is never touched.

Test user for scratch: `eric+scratch@aaacontracting.com`. Password lives
in Eric's password manager — not in the repo, not in the handoff. The
user_id is in `seed-scratch.sql` for reproducibility but is not a credential
on its own.

### Mac session pre-flight

Before the next-Mac-session work below can run, the Mac needs:

1. **`git pull` on `build-65b-session-a`.** Latest commits include the
   scratch replay + seed + dotenv-cli wiring + handoff updates.
2. **`.env.scratch.local` arrives via iMessage as an attachment.** It
   lands in `~/Downloads/` by default. **Move it to repo root before
   running anything:**
   ```bash
   mv ~/Downloads/.env.scratch.local <repo-path>/
   ```
   Verify it's still gitignored:
   ```bash
   git check-ignore -v .env.scratch.local
   ```
3. **`npm install`.** Picks up `dotenv-cli` and the two Capacitor
   plugins added in Session A (`@capacitor-community/camera-preview`,
   `@capacitor/filesystem`).
4. **Run dev with the dotenv-cli wrapper:**
   `npx dotenv -e .env.scratch.local -- npm run dev`
   Verify the client bundle has `jpzugbioqdjhhmuwqqeg.supabase.co`
   inlined, NOT `rzzprgidqbnqcdupmpfe.supabase.co`. Sign in as
   `eric+scratch@aaacontracting.com` to validate the scratch auth path
   end-to-end.
5. **Tooling note for next-Mac-Claude.** The Claude Preview MCP's
   `preview_start` does **not** honor `runtimeExecutable`/`runtimeArgs`
   in `.claude/launch.json`. It always runs `npm run dev` regardless,
   which loads `.env.local` (or worse — falls back to the parent
   worktree's prod `.env.local` per Next.js workspace-root inference).
   **Use the direct Bash invocation above, not preview_start.**
6. **Then** `npx cap sync ios` to copy the new web bundle into the iOS
   project. `npx cap open ios`, sign with Eric's developer account,
   install on iPhone via USB.

### Still deferred to the Mac/iPhone session

- [ ] EXIF read for width / height / orientation before sidecar write
      (Session A scaffold writes `0/0/1` placeholders).
- [ ] `npx cap sync ios` on Mac.
- [ ] Mac: `npx cap open ios`, sign with Eric's developer account,
      install on iPhone via USB.
- [ ] §5.2.A real-device verification: 20 rapid + 5 tag-after, review
      screen, delete 3, Done, 22 .jpg + 22 .json under
      `pending-uploads/...`, battery drain check after 100-shot rapid,
      permission-denied recovery flow.
- [ ] Battery / heat sanity check on a 100-rapid session.
- [ ] End-to-end scratch login + capture flow on the iPhone using the
      `eric+scratch@aaacontracting.com` credentials.

## Path B verification done in this session

- `npx tsc --noEmit` exits 0 (re-verified post-Session-A.5 after the
  `usePhotoTags` swap).
- `next dev` (Turbopack) compiles with no errors and no warnings beyond
  pre-existing image-LCP warnings on the login page.
- The new route compiles and is correctly auth-gated by `src/proxy.ts`
  (a request to `/jobs/<id>/capture` without cookies redirects to
  `/login`).
- The CaptureFab is rendered into `job-detail.tsx` but returns null on
  desktop (verified by code review of `useCapacitor` + the FAB's
  `if (!ready || !isNative) return null` short-circuit).

### Session A.5 smoke test (Windows, against scratch)

Started `next dev` with the dotenv-cli wrapper on port 3001:
`npx dotenv -e .env.scratch.local -- npm run dev -- --port 3001`. The
HTTP /login route returned 200, and the JS bundle on the client side
had `jpzugbioqdjhhmuwqqeg.supabase.co` (scratch) inlined for the
supabase client URL — confirmed by grepping the served chunks. Other
`*.supabase.co` strings in the bundle are doc-example placeholders from
`@supabase/supabase-js` (`example.supabase.co`, `xyzcompany.supabase.co`,
`id.supabase.co`, `realtime.supabase.co`).

Auth-gated routes (the desktop fallback card, the capture page itself)
are not hit on Windows because the test user's password isn't on this
machine — that smoke is part of the Mac session pre-flight above.

## Locked decisions surfaced this session

1. **`(mobile)` route group, not separate root layout.** Avoids the
   "multiple root layouts" full-page-reload caveat from the Next.js 16
   docs. The capture flow renders full-screen via `position: fixed
   inset-0 z-[1000]` so it covers AppShell without needing its own
   `<html>`/`<body>`.
2. **`Capacitor.isNativePlatform()` is the single source of truth for
   "are we in the iOS app?"** All gating (FAB visibility, capture page
   render path, future plugin wiring) goes through `useCapacitor`.
3. **Session ids stable across review → camera round-trip.** A user who
   captures 20, reviews, deletes 3, then taps "Camera" to grab 5 more
   ends up with 22 captures under one `capture_session_id`. Closing
   the capture flow entirely and reopening starts a new session.
4. **Plaintext on-device in Session A; encryption is 65c's job.** Plan
   §5.3 locked decision 2 said encrypted at rest; that gets introduced
   alongside the upload-queue scaffolding so the encryption test path
   and the upload test path move together.

## Branch state

- One commit on `build-65b-session-a` (this session's work + this
  handoff).
- **Do NOT merge to main.** Session C handles the merge after the
  TestFlight rollout per plan §5.2.C. This branch lives in the worktree
  at `.claude/worktrees/build-65b-session-a` and on `origin` once
  pushed.
- Untouched on `main`: prior 66d Obsidian work + uncommitted skill
  edits. The worktree isolated this work from those.

## Links

- Plan: [docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md](../plans/2026-04-26-build-65-mobile-platform.md)
- Build doc: [docs/vault/builds/build-65a.md](../../vault/builds/build-65a.md)
- Previous handoff: [docs/superpowers/build-65/65a-handoff.md](./65a-handoff.md)
- 65a Windows handoff: [docs/superpowers/build-65/65a-windows-handoff.md](./65a-windows-handoff.md)
