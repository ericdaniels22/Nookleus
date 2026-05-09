---
build_id: build-65c
title: Build 65c — Mobile upload pipeline + offline queue
date: 2026-05-08
status: design (awaiting plan)
supersedes_subsection_of: docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md §5.3
related: ["[[2026-05-08-build-65b-merge-and-iphone-smoke]]", "[[build-65b]]", "[[build-65c]]"]
---

# Build 65c — Mobile upload pipeline + offline queue (design)

## Summary

Photos captured by the 65b camera scaffold land in
`Documents/pending-uploads/{jobId}/{sessionId}/` as `{captureId}.jpg` +
`{captureId}.json` sidecar pairs, but currently have no path to the
`photos` table. 65c builds the queue that drains those local files to
Supabase Storage + the `photos` table, with encryption-at-rest, retry,
sync indicator UI, and iOS background-fetch.

Net result: crew shoot 200 photos in a basement with no signal, drive
back to the truck, photos appear on the platform — even if the app is
backgrounded.

## Locked decisions

These supersede plan §5.3's locked decisions where they conflict.

1. **Single session against AAA prod.** Plan §5.3 prescribed three
   sessions A/B/C with scratch-Supabase rehearsal in B; collapsed to one
   session against AAA prod per Eric (2026-05-08, "I don't need a
   scratch session. I don't have any real data on my app"). All
   §5.3.B test cases retained, run against prod.
2. **Encryption-at-rest stays.** AES-256-GCM via `crypto.subtle`; key
   stored in iOS Keychain via a Capacitor secure-storage plugin.
   Per-file random 12-byte IV prefixed on the ciphertext.
3. **Background sync stays.** `@capacitor/background-task` + iOS
   background-fetch entitlement (`UIBackgroundModes: ['fetch']` in
   Info.plist). Drains queue while app is backgrounded.
4. **EXIF read at upload time, not capture.** Capture continues to
   write `width: 0, height: 0, orientation: 1` placeholders to the
   sidecar; the upload worker reads real values from the decrypted blob
   via `exifr` immediately before `INSERT`.
5. **Sync indicator on the FAB.** Numeric badge overlays
   `<CaptureFab>` on `/jobs/[id]`. Long-press opens a queue sheet with
   per-photo retry / delete-from-queue actions.
6. **Sidecar JSON is the queue state journal** (option A from the
   approaches discussion). Upload state, retry count, last error, and
   owner PID live in the sidecar. Reuses the existing `updateSidecar()`
   path.
7. **Idempotency via `client_capture_id`** (already generated at capture
   in 65b). Partial unique index on
   `(organization_id, client_capture_id) WHERE client_capture_id IS NOT NULL`.
   Conflict on retry is treated as success.
8. **3-retry exponential backoff (1s / 5s / 30s), then mark `failed`.**
   `failed` photos require user action from the queue sheet.
9. **Auto-delete after successful sync.** No accumulation on device.
10. **App-private sandboxed storage.** Photos do NOT enter iOS Photos
    roll. Already true in 65b; restated here to lock for 65c.
11. **Existing platform features must work on mobile-captured photos.**
    Annotation editor, global gallery, before/after pairing, photo
    reports, all paths exercised in the test list.

## Scope additions

- **Bug fix in pass:** web `photo-upload.tsx` currently hard-codes
  `taken_by: 'Eric'` (line 148). Replace with active user's
  `user_profiles.full_name`. Mobile path uses the same source. Note:
  the column also has a default of `'Eric'::text`; the in-pass change
  passes a real value explicitly so the default never fires.
- **Bug fix in pass:** web `photo-upload.tsx` does not yet write
  `uploaded_from`. After migration applies, set `uploaded_from: 'web'`.
  (The `'web'` column default also covers any code path that omits it,
  including the photo-annotator's restore-from-backup INSERT path.)
- **Migration of existing 65b captures on Eric's device.** Any
  unencrypted `.jpg` files left over from 65b smoke get encrypted
  in-place on app launch by a one-time scan in
  `crypto-vault.ts:migrateUnencryptedFiles()`.

## Out of scope

- Thumbnail generation (`photos.thumbnail_path`). Plan §3.3 lists this
  as a 65c stretch; cut.
- Server-side EXIF strip. Photos uploaded as captured; if PII strip is
  ever needed, it is a separate build.
- Retry-forever / dead-letter queue UI beyond the per-photo sheet.
  Failed photos sit in the sheet until user acts.
- Multi-device sync of the queue. Each device maintains its own queue.

## Architecture

```
┌─ capture (65b, shipped) ──┐    ┌─ upload pipeline (65c, NEW) ─────────────────┐
│ camera-view.tsx           │    │ UploadQueueProvider (React Context)          │
│   ↓ writeCapture()        │    │   ↓ subscribes: app-state, network, bg-task  │
│ pending-uploads/          │ ─→ │   ↓ owns: UploadQueueWorker singleton        │
│   {jobId}/{sessionId}/    │    │                                              │
│     {captureId}.jpg.enc   │    │ UploadQueueWorker                            │
│     {captureId}.json      │    │   • scanAll() → list pending                 │
│   (encrypted at rest)     │    │   • drain() → 3-parallel uploads             │
│                           │    │   • per-photo: decrypt → EXIF → POST → INS   │
│ review-screen.tsx         │    │     → tag-link → delete local                │
│ capture-fab.tsx + BADGE   │    │                                              │
└───────────────────────────┘    │ CryptoVault (AES-256-GCM + Keychain key)     │
                                  │ NetworkMonitor (@capacitor/network)         │
                                  │ BackgroundTaskRunner (@capacitor/bg-task)   │
                                  │                                              │
                                  │ <UploadQueueBadge> on CaptureFab             │
                                  │ <UploadQueueSheet> bottom-sheet UI           │
                                  └──────────────────────────────────────────────┘
```

### New files

| Path | Purpose |
|---|---|
| `src/lib/mobile/crypto-vault.ts` | Keygen, Keychain store/retrieve, `encrypt(blob)`, `decrypt(blob)`, `migrateUnencryptedFiles()` |
| `src/lib/mobile/upload-queue.ts` | `UploadQueueWorker` class (scan, drain, uploadOne, markFailed, retry, deleteFromQueue) |
| `src/lib/mobile/upload-queue-context.tsx` | React Context provider; instantiates worker singleton; exposes `useUploadQueue()` hook |
| `src/lib/mobile/network-monitor.ts` | `@capacitor/network` wrapper; emits `online → drain()` |
| `src/lib/mobile/background-sync.ts` | `@capacitor/background-task` wrapper; iOS bg-fetch handler calling `worker.drain({budgetMs: 8000})` |
| `src/lib/mobile/exif-read.ts` | `readDimensions(blob): Promise<{width, height, orientation}>` via `exifr` |
| `src/components/mobile/upload-queue-badge.tsx` | Overlay on `<CaptureFab>`, blue/red/none state |
| `src/components/mobile/upload-queue-sheet.tsx` | Bottom-sheet listing queue items w/ retry/delete |
| `supabase/migrations/build65c-photos-mobile-fields.sql` | Schema additions (or apply via MCP if no local migrations dir) |
| `supabase/migrations/build65c-photos-mobile-fields.rollback.sql` | Rollback |

### Modified files

| Path | Change |
|---|---|
| `src/lib/mobile/capture-types.ts` | Extend `CaptureSidecar` with `upload_state, retry_count, last_error, last_attempt_at, worker_owner_pid` |
| `src/lib/mobile/capture-storage.ts` | `writeCapture()` encrypts before write; `readPhotoDataUrl()` decrypts; default upload-state fields on new sidecars |
| `src/components/mobile/capture-fab.tsx` | Wrap in relative container, mount `<UploadQueueBadge>` overlay; long-press → open `<UploadQueueSheet>` |
| `src/app/(mobile)/layout.tsx` (or wherever the mobile root lives) | Wrap children in `<UploadQueueProvider>` |
| `src/components/photo-upload.tsx` | In-pass: pass `uploaded_from: 'web'`; replace hardcoded `taken_by: 'Eric'` with `user_profiles.full_name` |
| `package.json` | Add `@capacitor/network`, `@capacitor/background-task`, `capacitor-secure-storage-plugin` (or chosen Keychain plugin), `exifr` |
| `ios/App/App/Info.plist` | Add `UIBackgroundModes: ['fetch']` |

### New deps

- `@capacitor/network` — online/offline detection
- `@capacitor/background-task` — iOS background-fetch native binding
- `capacitor-secure-storage-plugin` — Keychain wrapper. (Concrete pick to be confirmed in plan; alternates: `@capacitor-community/keychain`, `capacitor-native-biometric` w/ secure-storage extension. Pick the one with the smallest install footprint and active maintenance as of 2026-05.)
- `exifr` — small EXIF parser, ~30KB gzipped

After install, run `npx cap sync ios`; expect `Found 5 Capacitor plugins for ios` (was 2 after 65b).

## Schema

Migration `build65c-photos-mobile-fields`:

```sql
ALTER TABLE public.photos
  ADD COLUMN uploaded_from text NOT NULL DEFAULT 'web';
ALTER TABLE public.photos
  ADD COLUMN client_capture_id text;
CREATE UNIQUE INDEX photos_org_client_capture_id_key
  ON public.photos (organization_id, client_capture_id)
  WHERE client_capture_id IS NOT NULL;
COMMENT ON COLUMN public.photos.uploaded_from IS 'web|mobile';
COMMENT ON COLUMN public.photos.client_capture_id IS
  '65c idempotency key from mobile capture; web uploads leave NULL';
```

Rollback:

```sql
DROP INDEX IF EXISTS public.photos_org_client_capture_id_key;
ALTER TABLE public.photos DROP COLUMN IF EXISTS client_capture_id;
ALTER TABLE public.photos DROP COLUMN IF EXISTS uploaded_from;
```

Apply path: `mcp__claude_ai_Supabase__apply_migration` against AAA prod
project `rzzprgidqbnqcdupmpfe`. `list_tables` first to verify current
shape; `get_advisors` after to verify no new RLS warnings.

## Sidecar JSON shape (post-65c)

```ts
interface CaptureSidecar {
  // 65b existing fields
  client_capture_id: string;
  job_id: string;
  capture_session_id: string;
  taken_at: string;
  capture_mode: 'rapid' | 'tag-after';
  width: number;        // 65b placeholder 0; 65c worker patches before INSERT
  height: number;       // 65b placeholder 0; 65c worker patches before INSERT
  orientation: number;  // 65b placeholder 1; 65c worker patches before INSERT
  caption: string | null;
  tag_ids: string[];

  // 65c additions
  upload_state: 'pending' | 'uploading' | 'failed' | 'synced';
  retry_count: number;
  last_error: string | null;        // truncated to 200 chars
  last_attempt_at: string | null;   // ISO 8601
  worker_owner_pid: string | null;  // UUID per worker init; null when not owned
}
```

`synced` sidecars are deleted with their `.jpg.enc` partner immediately
after step 7 of `uploadOne`. The `synced` state exists only as a
transient marker between INSERT-success and file-delete; if the app
crashes between these steps, the next `scanAll()` re-uploads (idempotent
via the unique index).

## Data flow per photo

```
[trigger: app launch / network online / foreground / bg-fetch wake]
   ↓
worker.drain({budgetMs?}):
   ↓
  scanAll() → list sidecars w/ upload_state ∈ {pending, failed-but-eligible-for-backoff-retry}
              + recover orphans (upload_state='uploading' but worker_owner_pid != currentPid → reset to 'pending')
   ↓
  while items remain AND budgetMs not exceeded AND inflight < MAX_PARALLEL=3:
   ↓
  ┌─ uploadOne(capture) ─────────────────────────────────────────┐
  │ 1. claim: upload_state='uploading', worker_owner_pid=thisPid  │
  │           updateSidecar()                                     │
  │ 2. decrypt: read .jpg.enc → cryptoVault.decrypt() → blob      │
  │ 3. EXIF: exifRead.readDimensions(blob) → {w, h, orient}       │
  │    (fallback to 0/0/1 on parse failure)                       │
  │    only w/h are written to DB; orient kept on sidecar only    │
  │ 4. upload: supabase.storage.from('photos').upload(             │
  │      `${org}/${job}/${ts}-${rand6}.jpg`, blob,                 │
  │      {contentType: 'image/jpeg', upsert: false}                │
  │    )                                                          │
  │    on 401 → refresh session, retry ONCE                       │
  │ 5. INSERT INTO photos (...) — see "INSERT shape" below         │
  │    on 23505 (unique violation on idempotency idx) → success    │
  │ 6. INSERT INTO photo_tag_assignments (photo_id, tag_id)        │
  │    for each tag_ids[] entry, single batched insert            │
  │ 7. cleanup: deleteFile(.jpg.enc), deleteFile(.json)            │
  │ 8. emitState({captureId, state: 'synced'})                    │
  └──────────────────────────────────────────────────────────────┘
   ↓
  on any throw between steps 1-6:
    if retry_count < 3: state='pending', schedule retry at +delay(retry_count)
    else:               state='failed'
    retry_count += 1
    last_error = err.message.slice(0, 200)
    last_attempt_at = now
    updateSidecar(); emitState(...)
```

INSERT shape (verified against `public.photos` columns 2026-05-08):

```ts
{
  organization_id: <active org from auth ctx>,
  job_id: sidecar.job_id,
  storage_path: `${org}/${job}/${ts}-${rand6}.jpg`,
  uploaded_from: 'mobile',
  client_capture_id: sidecar.client_capture_id,
  taken_by: <user_profiles.full_name>,  // overrides column default 'Eric'::text
  taken_at: sidecar.taken_at,
  caption: sidecar.caption,
  width,        // from step 3 (exifr)
  height,       // from step 3 (exifr)
  file_size: blob.size,
  // media_type defaults to 'photo' at column level, omitted
  // thumbnail_path stays NULL (out of scope)
  // annotated_path stays NULL (set later by annotator)
  // before_after_pair_id / before_after_role stay NULL (set later by web pairing UI)
}
```

Note: `photos` table has NO `orientation` column. Sidecar's
`orientation: number` field is read at upload (step 3) for future use
but NOT written to DB. iOS Camera-preview returns already-rotated JPEGs
in practice, so orientation defaults to 1 and the field is currently
cosmetic. If a future build adds `photos.orientation`, the worker
already has the value ready.

Backoff schedule: `[1000, 5000, 30000]` ms by `retry_count`. After 3
failures, sidecar stays `failed` until user-initiated retry from
`<UploadQueueSheet>`. User retry resets `retry_count` to 0 and re-queues.

## Owner-PID race defuse

Worker generates a `thisPid` UUID at React mount time. Every claim writes
this PID to `worker_owner_pid`. On `scanAll()`:

- `upload_state='uploading' AND worker_owner_pid != thisPid` → orphan
  from a prior worker (e.g. user force-quit during upload, or app
  crashed mid-upload). Reset to `pending`, retry_count unchanged.
- User-initiated delete (from review screen or queue sheet) deletes
  both files; if upload was in flight, worker's next step throws
  file-not-found and the upload is abandoned without an INSERT.
- If delete happens between INSERT-success (step 5) and local-cleanup
  (step 7), INSERT is durable but local-cleanup throws not-found →
  swallowed. Next `scanAll()` will not re-process (sidecar gone). Net:
  no orphans, no duplicate rows (idempotency idx handles double-INSERT
  if it ever happens).

## Encryption design

`crypto-vault.ts`:

```ts
const KEYCHAIN_KEY = 'nookleus.upload-queue.aes-256-gcm.v1';

async function getOrCreateKey(): Promise<CryptoKey> {
  let raw = await secureStorage.get(KEYCHAIN_KEY);
  if (!raw) {
    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true /* extractable so we can store */,
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', generated);
    raw = base64Encode(exported);
    await secureStorage.set(KEYCHAIN_KEY, raw);
  }
  return crypto.subtle.importKey(
    'raw', base64Decode(raw),
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encrypt(blob: Blob): Promise<Blob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await getOrCreateKey(),
    await blob.arrayBuffer()
  );
  // Output: [12-byte IV][N-byte ciphertext+tag]
  return new Blob([iv, ciphertext]);
}

async function decrypt(encBlob: Blob): Promise<Blob> {
  const buf = await encBlob.arrayBuffer();
  const iv = new Uint8Array(buf, 0, 12);
  const ct = new Uint8Array(buf, 12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, await getOrCreateKey(), ct
  );
  return new Blob([plaintext], { type: 'image/jpeg' });
}
```

Key versioning via `KEYCHAIN_KEY` suffix `.v1`; future rotation can
ladder via `.v2` w/ a migration step.

`migrateUnencryptedFiles()` runs once on app launch:

```ts
for each `pending-uploads/{job}/{session}/` directory:
  for each *.jpg (no .enc suffix):
    blob = readFile(.jpg)
    encBlob = encrypt(blob)
    writeFile(.jpg.enc, encBlob)
    deleteFile(.jpg)
```

Idempotent: if `.jpg.enc` already exists alongside `.jpg`, the `.jpg` is
deleted (treats prior partial migration as truth). Logged to dev console
hook.

## Error handling matrix

| Class | Source | Retry? | UI |
|---|---|---|---|
| Network offline | step 4/5 timeout | yes (NetworkMonitor re-triggers drain on online) | badge stays blue, no failed-mark |
| 401 expired token | step 4/5 | refresh session, retry once; if refresh fails → failed | red badge, error: "sign in again" |
| 403 RLS rejection | step 5 | no (programmer error) | red badge, error: "permission denied — contact support" |
| 409 unique-idx collision | step 5 | no, success-path | silent, proceeds to step 7 |
| 5xx Supabase | step 4/5 | yes 3x w/ exp backoff | red badge after 3rd failure |
| Decrypt fail | step 2 | no (key changed / corrupt) | red badge, error: "photo unreadable — delete from queue" |
| EXIF parse fail | step 3 | no, fallback 0/0/1 + continue | none (silent) |
| Local-file-missing | step 2 | no (already deleted) | drop sidecar, no surface |
| Disk full on cleanup | step 7 | no (silent log) | none (data already cloud-side) |

## Sync indicator UI

`<UploadQueueBadge>` overlays `<CaptureFab>`. Visual states:

- **All synced** (no pending/uploading/failed): no badge.
- **Uploading or pending**: blue dot in upper-right of FAB with white
  numeric count (`{pending + uploading}`). 12pt minimum hit target.
- **Failed**: red dot with white count (`{failed}`). If both failed and
  pending exist, red wins (failed > pending in priority).
- **Animation**: pulse the blue dot during active upload; static
  otherwise. No animation on the red dot — failure should not be
  cheerful.

Long-press FAB (500ms threshold) → opens `<UploadQueueSheet>` via
existing bottom-sheet primitive. Tap-and-release continues to open
the camera (existing 65b behavior preserved).

`<UploadQueueSheet>`:

```
┌─────────────────────────────┐
│ Upload queue            [×] │
├─────────────────────────────┤
│ ╭───╮  Capture 14:32:01     │
│ │img│  Uploading…           │
│ ╰───╯                       │
├─────────────────────────────┤
│ ╭───╮  Capture 14:31:58     │
│ │img│  Pending (queued)     │
│ ╰───╯                       │
├─────────────────────────────┤
│ ╭───╮  Capture 14:31:42     │
│ │img│  Failed: network err  │
│ ╰───╯  [Retry] [Delete]     │
├─────────────────────────────┤
│  [Retry all failed]         │
└─────────────────────────────┘
```

Thumbnails are decrypted on demand (only for the currently-visible
sheet items; LRU cache of 20 in worker memory to avoid re-decrypting on
sheet re-open within the same session).

## Testing

Single session against AAA prod. Eric signed in as his normal user.
Test job: a fresh job created for the test pass (so cleanup is one
DELETE on the job + its photo cascade).

| # | Test | Method |
|---|---|---|
| 1 | Capture 50 w/ signal → all upload < 5min | iPhone, normal cell, watch FAB badge zero out |
| 2 | Capture 100 in airplane → drain on online | airplane on, 100 shots, airplane off, watch drain |
| 3 | Mock 5xx → 3 retries → failed mark | temporary route `/api/_test/photo-upload-fail` returning 503, gated by `process.env.NODE_ENV !== 'production'`; OR more rigorous: temp Supabase storage policy that rejects, lifted post-test |
| 4 | Failed → manual retry from sheet | tap retry, watch state |
| 5 | Failed → delete from sheet | tap delete; sidecar + .enc gone, no INSERT, no orphan blob |
| 6 | App killed mid-upload → queue intact | force-quit during drain, reopen, sidecars w/ stale `worker_owner_pid` reset to `pending` on init |
| 7 | Background fetch wakes app → drains | airplane off, swipe to Notes app, force bg-fetch via Xcode → Debug → Simulate Background Fetch |
| 8 | Encrypted file unreadable via Xcode | Xcode Devices → iPhone → Nookleus container → Documents/pending-uploads → save .enc to Mac → `xxd` shows random bytes |
| 9 | Same client_capture_id 2x → 1 row | manually re-queue a synced sidecar, observe INSERT collision + silent skip |
| 10 | `uploaded_from='mobile'` set | SELECT after upload via Supabase MCP |
| 11 | `taken_by` = full name, not 'Eric' literal | SELECT after upload |
| 12 | `organization_id` = AAA's id | SELECT after upload |
| 13 | Photo appears in `/jobs/[id]` photos tab on web | open web, navigate to test job |
| 14 | Photo in `/photos` global gallery | navigate, scroll to recent |
| 15 | Annotation editor works on mobile photo | open one, draw, save |
| 16 | Before/after pairing works | drag two together |
| 17 | Photo report includes mobile photos | run a report including the test job |
| 18 | Web upload still writes `uploaded_from='web'` (in-pass fix) | upload via web, SELECT |
| 19 | Web `taken_by` no longer literal "Eric" (in-pass fix) | upload via web as different user, SELECT |

Cleanup: web-UI batch-delete on test job's photos (or `DELETE FROM
photos WHERE job_id=?` via Supabase MCP if no batch UI), then delete
the test job. Storage cleanup: verify no orphan blobs in
`photos/${org}/${jobId}/` via `list_objects` then bulk-delete via
Supabase MCP if any remain.

## Sequencing within the single session

Not formally A/B/C, but a natural ordering:

1. **Schema first.** Migration applied to AAA prod. Verified with
   `list_tables`. Web `photo-upload.tsx` in-pass fix shipped same
   commit so the new column is populated immediately on existing
   web traffic.
2. **Crypto vault + filesystem encryption** (no upload behavior yet).
   Migrate any existing 65b captures on Eric's iPhone.
3. **Worker + queue context + native deps.** No UI yet. Verify in
   Xcode console that drain runs and would-upload (dry-run flag).
4. **Upload path live.** Tests 1, 10–14 from the table.
5. **Failure path + retry.** Tests 3–5.
6. **App-state + background-fetch.** Tests 6–7.
7. **Encryption verification.** Test 8.
8. **Idempotency.** Test 9.
9. **Annotation / gallery / pairing / report integrations.** Tests 15–17.
10. **In-pass web fixes verified.** Tests 18–19.
11. **TestFlight push** so iPhone gets a build with the new native deps.
    Eric installs from TestFlight and re-runs end-to-end smoke.

If any step blocks, halt and replan. The session can pause at any of
these checkpoints with a partial handoff; encryption + worker without
the bg-fetch native dance is still useful (foreground-only sync).

## Risks

- **Keychain plugin choice.** `capacitor-secure-storage-plugin` last
  shipped under @capacitor/core v6 in the README; needs a quick
  compatibility verification against our Capacitor 8. Fallback:
  `@capacitor-community/keychain` or roll a tiny Swift plugin (~30
  lines). Deferred to plan task that picks the dep.
- **iOS background-fetch is best-effort.** System schedules wakes; can
  be days between fires on a backgrounded app. Worst case is mitigated
  by foreground-on-open drain. Don't oversell to crew.
- **`exifr` bundle size on web.** Not used by web today; mobile-only
  import. Verify webpack tree-shakes the web bundle.
- **`crypto.subtle` on iOS WKWebView.** Available since iOS 11; safe.
  Performance on 5MB+ photos: AES-GCM is hardware-accelerated on A-series
  chips, ~50ms per photo expected. Not a concern at capture rate.
- **Storage rate limits.** Supabase free/pro tier has per-second upload
  caps (~100/min on pro). 3-parallel + ~1s per photo is well under.
  100 photos in airplane drain at 3-parallel = ~33s; comfortable.
- **Unique-index race at INSERT.** Two devices uploading the same
  `client_capture_id` is impossible (the UUID is generated at capture
  time, per device, so collision odds are 1 in 2^122). The index is
  there for retries, not multi-device.

## Open questions for the implementation plan

- ~~Concrete Keychain plugin pick (one of three candidates listed above).~~ **Resolved 2026-05-08:** chose `capacitor-secure-storage-plugin@0.13.0` because it explicitly declares Capacitor 8 compatibility (`@capacitor/core: >=8.0.0`), is actively maintained (last publish 3 months ago), and has no peer-dep ceiling.
- Whether to gate the `/api/_test/photo-upload-fail` route behind a
  build flag or rely on a temporary Supabase policy for the failure-path
  test. Build flag is cleaner; policy is more realistic.
- Whether to migrate existing 65b captures on Eric's device or wipe
  them and re-shoot for the test pass. Migration is the correct code
  path to ship; wiping is the faster test path.

## Spec self-review notes

- All "TBD"-class items live under "Open questions" above and are
  resolvable during plan-writing without redesign.
- Sidecar JSON shape is the single source of truth for queue state;
  no contradictions with the in-memory worker map (worker map is a
  cache rebuilt from sidecars on init).
- `taken_by` fix scope: documented as in-pass, not bolted on as a
  surprise. Listed in Schema additions and in test #19.
- `uploaded_from` default of `'web'` means existing web-upload code
  paths that don't know about the column produce correct rows even
  before the in-pass code change merges. Defensive default chosen
  deliberately.
