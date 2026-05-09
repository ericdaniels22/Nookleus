# Build 65c — Mobile Upload Pipeline + Offline Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drain photos captured by 65b's camera scaffold (sitting at `Documents/pending-uploads/{jobId}/{sessionId}/`) to Supabase Storage + the `photos` table — encrypted at rest on device, retried with exp backoff, surfaced via a FAB badge, draining in the background.

**Architecture:** AES-256-GCM encryption-at-rest with key in iOS Keychain. Sidecar JSON is the queue state journal (option A from design discussion). Upload worker is a singleton owned by a React Context provider; triggers on app launch, network online, foreground return, and iOS background-fetch wake. Per-photo pipeline: claim → decrypt → EXIF → POST → INSERT → tag-link → cleanup. Idempotency via partial unique index on `(organization_id, client_capture_id)`. Single session against AAA prod (no scratch rehearsal).

**Tech Stack:** Next.js 16, Capacitor 8, `@capacitor/filesystem` (already shipped 65b), `@capacitor/network` (new), `@capacitor/background-task` (new), `capacitor-secure-storage-plugin` (new — Keychain wrapper), `exifr` (new — EXIF parser), `crypto.subtle` (built-in WKWebView), Supabase JS client (existing). Vitest added for pure-logic unit tests.

**Spec:** `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md`

**Branch strategy:** Single feature branch `build-65c-upload-pipeline` off main. PR + merge after smoke pass. No A/B/C session split.

**Supabase project:** AAA prod `rzzprgidqbnqcdupmpfe`.

---

## File structure

### Created

| Path | Purpose |
|---|---|
| `src/lib/mobile/crypto-vault.ts` | Keygen, Keychain store, `encrypt(blob)`, `decrypt(blob)`, `migrateUnencryptedFiles()` |
| `src/lib/mobile/crypto-vault.test.ts` | Unit tests: encrypt-decrypt roundtrip, IV format, migration idempotency |
| `src/lib/mobile/exif-read.ts` | `readDimensions(blob): Promise<{width, height, orientation}>` via `exifr`; fallback on parse failure |
| `src/lib/mobile/exif-read.test.ts` | Unit tests: known-good fixture, malformed-file fallback |
| `src/lib/mobile/upload-queue.ts` | `UploadQueueWorker` class: scanAll, drain, uploadOne, markFailed, retry, deleteFromQueue |
| `src/lib/mobile/upload-queue.test.ts` | Unit tests: backoff math, owner-PID race, idempotency conflict-as-success |
| `src/lib/mobile/upload-queue-context.tsx` | React Context + `<UploadQueueProvider>` + `useUploadQueue()` hook |
| `src/lib/mobile/network-monitor.ts` | `@capacitor/network` wrapper, online → trigger callback |
| `src/lib/mobile/background-sync.ts` | `@capacitor/background-task` wrapper, iOS bg-fetch handler |
| `src/components/mobile/upload-queue-badge.tsx` | Overlay on `<CaptureFab>`: blue/red/none state |
| `src/components/mobile/upload-queue-sheet.tsx` | Bottom-sheet listing queue items + retry/delete |
| `vitest.config.ts` | Minimal Vitest config |

### Modified

| Path | Change |
|---|---|
| `src/lib/mobile/capture-types.ts` | Extend `CaptureSidecar` with 5 new upload-state fields |
| `src/lib/mobile/capture-storage.ts` | `writeCapture()` encrypts before write; `readPhotoDataUrl()` decrypts; default upload-state on new sidecars |
| `src/components/mobile/capture-fab.tsx` | Wrap in relative container; mount badge overlay; long-press → sheet |
| `src/app/(mobile)/jobs/[id]/capture/layout.tsx` (or nearest mobile root layout) | Wrap children in `<UploadQueueProvider>` |
| `src/components/photo-upload.tsx` | In-pass: pass `uploaded_from: 'web'`; replace literal `taken_by: 'Eric'` with `user_profiles.full_name` |
| `package.json` | Add `@capacitor/network`, `@capacitor/background-task`, `capacitor-secure-storage-plugin`, `exifr`; devDep `vitest`, `@vitest/ui`, `jsdom` |
| `ios/App/App/Info.plist` | Add `UIBackgroundModes: ['fetch']` |

### Migration applied via Supabase MCP (no local migrations dir in this repo)

| Migration | Purpose |
|---|---|
| `build65c_photos_mobile_fields` | Add `uploaded_from text DEFAULT 'web'`, `client_capture_id text`, partial unique index |

---

## Task 0: Pre-flight — pick Keychain plugin + verify Capacitor 8 compat

**Files:** none yet (research task; outcome lands in Task 1's `npm install`)

- [ ] **Step 1: Inspect three candidate Keychain plugins for Capacitor 8 compat**

```bash
npm view capacitor-secure-storage-plugin peerDependencies
npm view @capacitor-community/keychain peerDependencies
npm view capacitor-secure-storage peerDependencies
```

Expected: at least one of the three lists `@capacitor/core: ^8` or no peer-dep at all (works with anything). Pick the highest-starred maintained one that lists Capacitor 8 compat.

- [ ] **Step 2: Document the pick in the spec**

Edit `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md` "Open questions" section — strike through the Keychain question, record the chosen plugin name + version. Commit:

```bash
git add docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md
git commit -m "spec(65c): pick Keychain plugin — <name> <version>"
```

If NONE of the three are Capacitor-8-compatible, halt and escalate. Fallback option = roll a 30-line Swift secure-storage plugin in `ios/App/Plugins/` per Capacitor 8's plugin-author guide; this becomes a separate sub-task.

---

## Task 1: Pre-flight — branch, install deps, vitest config

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Create + checkout feature branch**

```bash
git checkout -b build-65c-upload-pipeline
git status
```

Expected: on `build-65c-upload-pipeline`, working tree clean except `out/`.

- [ ] **Step 2: Install runtime deps**

```bash
npm install @capacitor/network @capacitor/background-task <chosen-keychain-plugin> exifr
```

Replace `<chosen-keychain-plugin>` with the package name picked in Task 0.

Expected: 4 new entries in `dependencies`. No peer-dep warnings.

- [ ] **Step 3: Install dev deps for vitest**

```bash
npm install -D vitest @vitest/ui jsdom
```

Expected: 3 new entries in `devDependencies`.

- [ ] **Step 4: Add vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "out", "ios"],
  },
});
```

- [ ] **Step 5: Add test scripts to package.json**

Modify the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 6: Verify vitest runs (no tests yet)**

```bash
npm test
```

Expected: `No test files found` exit 0 (vitest handles empty suite gracefully) OR exit 1 with that message; either is fine. If config error, fix.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "feat(65c): install upload-pipeline deps + vitest config"
```

---

## Task 2: Apply schema migration to AAA prod

**Files:** none modified locally; runs via Supabase MCP.

- [ ] **Step 1: Verify current photos table shape**

Use `mcp__claude_ai_Supabase__list_tables` with `project_id: rzzprgidqbnqcdupmpfe`, `schemas: ["public"]`, `verbose: true`. Confirm `photos` table does NOT yet have `uploaded_from` or `client_capture_id` columns.

Expected: 16 columns matching the spec's "verified against `public.photos` columns 2026-05-08" list.

- [ ] **Step 2: Apply migration**

Use `mcp__claude_ai_Supabase__apply_migration`:
- `project_id: rzzprgidqbnqcdupmpfe`
- `name: build65c_photos_mobile_fields`
- `query`:

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

Expected: success.

- [ ] **Step 3: Verify migration applied + index in place**

Use `mcp__claude_ai_Supabase__execute_sql` with:

```sql
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'photos'
   AND column_name IN ('uploaded_from', 'client_capture_id');

SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename='photos'
   AND indexname='photos_org_client_capture_id_key';
```

Expected: 2 column rows, 1 index row with `WHERE (client_capture_id IS NOT NULL)` in the indexdef.

- [ ] **Step 4: Run advisors check**

Use `mcp__claude_ai_Supabase__get_advisors` with `type: 'security'`. Expected: no new advisories caused by the migration. (If RLS lints flag the new column not having a policy — `photos` table-level RLS already covers row access; column-level perms are inherited.)

- [ ] **Step 5: Save rollback SQL alongside spec for posterity**

Append to `docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md` at the bottom (or create a sibling `.rollback.sql` file):

```sql
-- Rollback for build65c_photos_mobile_fields
DROP INDEX IF EXISTS public.photos_org_client_capture_id_key;
ALTER TABLE public.photos DROP COLUMN IF EXISTS client_capture_id;
ALTER TABLE public.photos DROP COLUMN IF EXISTS uploaded_from;
```

Commit:

```bash
git add docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md
git commit -m "spec(65c): record rollback SQL for build65c_photos_mobile_fields"
```

---

## Task 3: Web in-pass fix — uploaded_from + taken_by

**Files:**
- Modify: `src/components/photo-upload.tsx:141-154`

- [ ] **Step 1: Read current INSERT shape**

Open `src/components/photo-upload.tsx` lines 100-180. Confirm the literal `taken_by: 'Eric'` at line 148 and the absence of `uploaded_from`.

- [ ] **Step 2: Read user-profile resolution pattern from another existing route**

Find an existing route or page that reads `user_profiles.full_name` for the active user. Likely candidates: `src/app/(app)/.../layout.tsx` or `src/lib/auth/*`. Use `grep -rn "full_name" src/`.

The pattern in this codebase is typically:

```ts
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase.from("user_profiles")
  .select("full_name").eq("id", user.id).single();
```

Or there's a helper. Use whatever the codebase already uses; do NOT introduce a new pattern.

- [ ] **Step 3: Modify the INSERT**

Replace lines 141-154:

```ts
const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from("user_profiles")
  .select("full_name")
  .eq("id", user!.id)
  .single();

const { data: photoData, error: insertError } = await supabase
  .from("photos")
  .insert({
    organization_id: orgId,
    job_id: jobId,
    storage_path: fileName,
    uploaded_from: "web",
    caption: filePreview.caption || null,
    taken_by: profile?.full_name || user!.email || "unknown",
    media_type: mediaType,
    file_size: filePreview.file.size,
    before_after_role: filePreview.beforeAfterRole,
  })
  .select("id")
  .single();
```

Note: defensive fallback to `user.email` then `'unknown'` so an empty profile doesn't break the upload. Discussed in spec.

- [ ] **Step 4: Hoist user/profile resolution out of the file loop**

The `for (const filePreview of files)` loop at line 119 calls `getUser` once per file. Hoist `user` and `profile` lookups OUT of the loop, above line 119. They don't change per file.

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/photo-upload.tsx
git commit -m "fix(65c-pass): web photo upload writes uploaded_from + real taken_by"
```

---

## Task 4: Sidecar type extension

**Files:**
- Modify: `src/lib/mobile/capture-types.ts`

- [ ] **Step 1: Extend CaptureSidecar**

Replace the file contents:

```ts
export type CaptureMode = "rapid" | "tag-after";

export type UploadState = "pending" | "uploading" | "failed" | "synced";

export interface CaptureSidecar {
  client_capture_id: string;
  job_id: string;
  capture_session_id: string;
  taken_at: string;
  capture_mode: CaptureMode;
  width: number;
  height: number;
  orientation: number;
  caption: string | null;
  tag_ids: string[];

  // 65c upload state (defaults set on write)
  upload_state: UploadState;
  retry_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  worker_owner_pid: string | null;
}

export interface PendingCapture {
  sidecar: CaptureSidecar;
  thumbnail_data_url: string;
}
```

- [ ] **Step 2: Type-check (will fail in capture-storage.ts and review-screen.tsx until Tasks 6 + downstream fix it)**

```bash
npx tsc --noEmit
```

Expected: errors in `capture-storage.ts:writeCapture` (sidecar arg missing fields) and possibly `review-screen.tsx` / `camera-view.tsx`. These are addressed in Task 6.

- [ ] **Step 3: DON'T commit yet — bundle with Task 6's commit**

Sidecar type is meaningless without storage layer + capture sites updated. Hold the staged change.

---

## Task 5: CryptoVault module + tests

**Files:**
- Create: `src/lib/mobile/crypto-vault.ts`
- Create: `src/lib/mobile/crypto-vault.test.ts`

- [ ] **Step 1: Write failing test for encrypt-decrypt roundtrip**

Create `src/lib/mobile/crypto-vault.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt, decrypt } from "./crypto-vault";

vi.mock("<chosen-keychain-plugin>", () => {
  let store: Record<string, string> = {};
  return {
    SecureStorage: {
      get: async ({ key }: { key: string }) => store[key] ?? null,
      set: async ({ key, value }: { key: string; value: string }) => {
        store[key] = value;
      },
    },
  };
});

beforeEach(() => {
  // ensure crypto.subtle is available in jsdom env
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto = require("node:crypto").webcrypto as Crypto;
  }
});

describe("crypto-vault", () => {
  it("encrypts and decrypts a blob roundtrip", async () => {
    const plain = new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
      type: "image/jpeg",
    });
    const encBlob = await encrypt(plain);
    expect(encBlob.size).toBeGreaterThan(plain.size); // IV + tag overhead
    const decBlob = await decrypt(encBlob);
    const out = new Uint8Array(await decBlob.arrayBuffer());
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it("encrypts produce different ciphertext on each call (random IV)", async () => {
    const plain = new Blob([new Uint8Array([9, 9, 9])]);
    const a = new Uint8Array(await (await encrypt(plain)).arrayBuffer());
    const b = new Uint8Array(await (await encrypt(plain)).arrayBuffer());
    expect(Array.from(a)).not.toEqual(Array.from(b)); // IV differs
  });
});
```

Replace `<chosen-keychain-plugin>` with the actual package name from Task 0.

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- crypto-vault
```

Expected: FAIL — `Cannot find module './crypto-vault'`.

- [ ] **Step 3: Implement crypto-vault.ts**

Create `src/lib/mobile/crypto-vault.ts`:

```ts
import { SecureStorage } from "<chosen-keychain-plugin>";
import { Directory, Filesystem } from "@capacitor/filesystem";

const KEYCHAIN_KEY = "nookleus.upload-queue.aes-256-gcm.v1";
const IV_LEN = 12;

let cachedKey: CryptoKey | null = null;

async function getOrCreateKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const existing = await SecureStorage.get({ key: KEYCHAIN_KEY });
  let rawB64 = existing;

  if (!rawB64) {
    const generated = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const exported = await crypto.subtle.exportKey("raw", generated);
    rawB64 = bufToBase64(exported);
    await SecureStorage.set({ key: KEYCHAIN_KEY, value: rawB64 });
  }

  const rawBuf = base64ToBuf(rawB64);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    rawBuf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

export async function encrypt(blob: Blob): Promise<Blob> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    await blob.arrayBuffer(),
  );
  return new Blob([iv, ct]);
}

export async function decrypt(encBlob: Blob): Promise<Blob> {
  const key = await getOrCreateKey();
  const buf = await encBlob.arrayBuffer();
  const iv = new Uint8Array(buf, 0, IV_LEN);
  const ct = new Uint8Array(buf, IV_LEN);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Blob([plain], { type: "image/jpeg" });
}

/**
 * One-time scan: encrypt any leftover unencrypted .jpg files from 65b smoke
 * sessions. Safe to run repeatedly; idempotent.
 */
export async function migrateUnencryptedFiles(): Promise<{
  encrypted: number;
  skipped: number;
}> {
  let encrypted = 0;
  let skipped = 0;

  const root = "pending-uploads";
  let jobDirs: string[] = [];
  try {
    const r = await Filesystem.readdir({
      path: root,
      directory: Directory.Documents,
    });
    jobDirs = r.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return { encrypted, skipped };
  }

  for (const jobDir of jobDirs) {
    const sessions = await Filesystem.readdir({
      path: `${root}/${jobDir}`,
      directory: Directory.Documents,
    }).catch(() => ({ files: [] as Array<string | { name: string }> }));

    for (const sessRaw of sessions.files) {
      const sess = typeof sessRaw === "string" ? sessRaw : sessRaw.name;
      const filesR = await Filesystem.readdir({
        path: `${root}/${jobDir}/${sess}`,
        directory: Directory.Documents,
      }).catch(() => ({ files: [] as Array<string | { name: string }> }));

      const names = filesR.files.map((f) => (typeof f === "string" ? f : f.name));
      const jpgs = names.filter((n) => n.endsWith(".jpg"));

      for (const jpg of jpgs) {
        const enc = jpg + ".enc";
        const path = `${root}/${jobDir}/${sess}/${jpg}`;
        const encPath = `${root}/${jobDir}/${sess}/${enc}`;

        if (names.includes(enc)) {
          // Already migrated; just delete the stale plaintext.
          await Filesystem.deleteFile({ path, directory: Directory.Documents });
          skipped++;
          continue;
        }

        const r = await Filesystem.readFile({
          path,
          directory: Directory.Documents,
        });
        const b64 = typeof r.data === "string" ? r.data : await blobToBase64(r.data);
        const plain = base64ToBlob(b64, "image/jpeg");
        const encBlob = await encrypt(plain);
        const encB64 = bufToBase64(await encBlob.arrayBuffer());
        await Filesystem.writeFile({
          path: encPath,
          data: encB64,
          directory: Directory.Documents,
        });
        await Filesystem.deleteFile({ path, directory: Directory.Documents });
        encrypted++;
      }
    }
  }

  return { encrypted, skipped };
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64ToBlob(b64: string, type: string): Blob {
  return new Blob([base64ToBuf(b64)], { type });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return bufToBase64(await blob.arrayBuffer());
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test -- crypto-vault
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile/crypto-vault.ts src/lib/mobile/crypto-vault.test.ts
git commit -m "feat(65c): crypto-vault — AES-256-GCM encrypt/decrypt + Keychain key + 65b file migration"
```

---

## Task 6: capture-storage.ts encrypt-on-write + decrypt-on-read

**Files:**
- Modify: `src/lib/mobile/capture-storage.ts`
- Stage: `src/lib/mobile/capture-types.ts` (from Task 4)

- [ ] **Step 1: Replace writeCapture, readPhotoDataUrl, listSessionCaptures, deleteCapture**

Modify `src/lib/mobile/capture-storage.ts`:

Top imports — add:

```ts
import { encrypt, decrypt } from "./crypto-vault";
```

Helpers — add encrypted path:

```ts
export function getEncryptedPhotoPath(jobId: string, sessionId: string, captureId: string) {
  return `${getSessionDir(jobId, sessionId)}/${captureId}.jpg.enc`;
}
```

Modify `writeCapture` (replaces current implementation):

```ts
export async function writeCapture(args: {
  base64Data: string;
  sidecar: CaptureSidecar;
}): Promise<void> {
  const { base64Data, sidecar } = args;
  const { job_id, capture_session_id, client_capture_id } = sidecar;
  await ensureSessionDir(job_id, capture_session_id);

  // Decode base64 → blob → encrypt → re-encode → write .jpg.enc
  const plainBuf = base64ToBuf(base64Data);
  const plainBlob = new Blob([plainBuf], { type: "image/jpeg" });
  const encBlob = await encrypt(plainBlob);
  const encB64 = bufToBase64(await encBlob.arrayBuffer());

  await Filesystem.writeFile({
    path: getEncryptedPhotoPath(job_id, capture_session_id, client_capture_id),
    data: encB64,
    directory: DIRECTORY,
  });

  // Sidecar: write upload-state defaults if caller didn't supply
  const fullSidecar: CaptureSidecar = {
    upload_state: "pending",
    retry_count: 0,
    last_error: null,
    last_attempt_at: null,
    worker_owner_pid: null,
    ...sidecar,
  };

  await Filesystem.writeFile({
    path: getSidecarPath(job_id, capture_session_id, client_capture_id),
    data: JSON.stringify(fullSidecar, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
}
```

Modify `readPhotoDataUrl` (decrypt path; falls back to plaintext for not-yet-migrated files):

```ts
export async function readPhotoDataUrl(
  jobId: string,
  sessionId: string,
  captureId: string,
): Promise<string> {
  // Try encrypted first; fall back to plaintext if .enc missing.
  const encPath = getEncryptedPhotoPath(jobId, sessionId, captureId);
  const plainPath = getPhotoPath(jobId, sessionId, captureId);

  try {
    const r = await Filesystem.readFile({ path: encPath, directory: DIRECTORY });
    const encB64 = typeof r.data === "string" ? r.data : await blobToBase64(r.data);
    const encBlob = new Blob([base64ToBuf(encB64)]);
    const plainBlob = await decrypt(encBlob);
    const plainB64 = bufToBase64(await plainBlob.arrayBuffer());
    return `data:image/jpeg;base64,${plainB64}`;
  } catch {
    // Fallback for any leftover unencrypted file (pre-migration smoke)
    const r = await Filesystem.readFile({ path: plainPath, directory: DIRECTORY });
    const plainB64 =
      typeof r.data === "string" ? r.data : await blobToBase64(r.data);
    return `data:image/jpeg;base64,${plainB64}`;
  }
}
```

Modify `listSessionCaptures` to also recognize encrypted files (look for `.json` sidecar; whether the photo is `.jpg` or `.jpg.enc` is irrelevant for listing — `readPhotoDataUrl` handles both):

```ts
export async function listSessionCaptures(
  jobId: string,
  sessionId: string,
): Promise<PendingCapture[]> {
  let names: string[] = [];
  try {
    const result = await Filesystem.readdir({
      path: getSessionDir(jobId, sessionId),
      directory: DIRECTORY,
    });
    names = result.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return [];
  }
  const sidecarNames = names.filter((n) => n.endsWith(".json"));
  const captures: PendingCapture[] = [];
  for (const name of sidecarNames) {
    const captureId = name.replace(/\.json$/, "");
    try {
      const sidecar = await readSidecar(jobId, sessionId, captureId);
      const thumbnail_data_url = await readPhotoDataUrl(jobId, sessionId, captureId);
      captures.push({ sidecar, thumbnail_data_url });
    } catch {
      // Skip damaged entries
    }
  }
  captures.sort((a, b) => a.sidecar.taken_at.localeCompare(b.sidecar.taken_at));
  return captures;
}
```

Modify `deleteCapture` to delete BOTH possible photo paths:

```ts
export async function deleteCapture(
  jobId: string,
  sessionId: string,
  captureId: string,
): Promise<void> {
  await Promise.allSettled([
    Filesystem.deleteFile({
      path: getEncryptedPhotoPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
    Filesystem.deleteFile({
      path: getPhotoPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
    Filesystem.deleteFile({
      path: getSidecarPath(jobId, sessionId, captureId),
      directory: DIRECTORY,
    }),
  ]);
}
```

Add helpers at bottom (near existing `blobToBase64`):

```ts
function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
```

- [ ] **Step 2: Verify camera-view.tsx still compiles**

```bash
npx tsc --noEmit
```

Expected: clean (or only the expected errors that get fixed in later tasks). The sidecar type extension allows `writeCapture` to fill defaults via the spread.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: ✓ Compiled successfully.

- [ ] **Step 4: Commit (bundles Task 4's staged change)**

```bash
git add src/lib/mobile/capture-storage.ts src/lib/mobile/capture-types.ts
git commit -m "feat(65c): capture-storage encrypts on write + decrypts on read; sidecar gets upload-state fields"
```

---

## Task 7: ExifRead module + tests

**Files:**
- Create: `src/lib/mobile/exif-read.ts`
- Create: `src/lib/mobile/exif-read.test.ts`

- [ ] **Step 1: Write failing test for known fixture**

Create `src/lib/mobile/exif-read.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readDimensions } from "./exif-read";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("exif-read", () => {
  it("reads width/height/orientation from a known JPEG", async () => {
    // Use any small JPEG fixture; if none, generate one in setup
    const buf = readFileSync(
      resolve(__dirname, "__fixtures__/sample-640x480-orient1.jpg"),
    );
    const blob = new Blob([buf], { type: "image/jpeg" });
    const dims = await readDimensions(blob);
    expect(dims.width).toBe(640);
    expect(dims.height).toBe(480);
    expect(dims.orientation).toBe(1);
  });

  it("falls back to 0/0/1 on a non-JPEG blob", async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], {
      type: "application/octet-stream",
    });
    const dims = await readDimensions(blob);
    expect(dims).toEqual({ width: 0, height: 0, orientation: 1 });
  });
});
```

- [ ] **Step 2: Generate the fixture if it doesn't exist**

```bash
mkdir -p src/lib/mobile/__fixtures__
# Use ImageMagick or a quick Node script to make a 640x480 JPEG:
node -e "
const { writeFileSync } = require('fs');
// Tiny 640x480 white JPEG via canvas-less approach: use a precomputed minimal one.
// Easier: download a known-good test image:
"
# Easiest path: use sips on macOS to generate from a screenshot or any photo
# sips -z 480 640 ~/some-photo.jpg --out src/lib/mobile/__fixtures__/sample-640x480-orient1.jpg
# Or commit a tiny existing fixture from another open-source project.
```

Concrete: generate via ImageMagick if installed (`brew install imagemagick`), else use `sips`:

```bash
sips -z 480 640 -s format jpeg /System/Library/Desktop\ Pictures/Hello.heic --out src/lib/mobile/__fixtures__/sample-640x480-orient1.jpg 2>/dev/null \
  || sips -z 480 640 -s format jpeg /System/Library/Desktop\ Pictures/Solid\ Colors/Black.png --out src/lib/mobile/__fixtures__/sample-640x480-orient1.jpg
```

If neither works, take any photo on Eric's iPhone, AirDrop to `/tmp/`, run `sips` to size it 640x480.

- [ ] **Step 3: Run test — fails (no impl)**

```bash
npm test -- exif-read
```

Expected: FAIL — `Cannot find module './exif-read'`.

- [ ] **Step 4: Implement exif-read.ts**

Create `src/lib/mobile/exif-read.ts`:

```ts
import exifr from "exifr";

export interface PhotoDimensions {
  width: number;
  height: number;
  orientation: number;
}

const FALLBACK: PhotoDimensions = { width: 0, height: 0, orientation: 1 };

export async function readDimensions(blob: Blob): Promise<PhotoDimensions> {
  try {
    const buf = await blob.arrayBuffer();
    // Read just dimensions + orientation; pickTags keeps parse fast on large images
    const meta = await exifr.parse(buf, {
      pick: ["ImageWidth", "ImageHeight", "Orientation",
             "PixelXDimension", "PixelYDimension",
             "ExifImageWidth", "ExifImageHeight"],
    });
    if (!meta) return FALLBACK;
    const width =
      meta.ExifImageWidth ?? meta.PixelXDimension ?? meta.ImageWidth ?? 0;
    const height =
      meta.ExifImageHeight ?? meta.PixelYDimension ?? meta.ImageHeight ?? 0;
    const orientation = meta.Orientation ?? 1;
    return { width, height, orientation };
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 5: Run tests — should pass**

```bash
npm test -- exif-read
```

Expected: 2 tests pass. If the fixture's actual dimensions differ (e.g. sips produces 640x480 but EXIF says different), update the test's expected values to match the fixture.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobile/exif-read.ts src/lib/mobile/exif-read.test.ts src/lib/mobile/__fixtures__/
git commit -m "feat(65c): exif-read — width/height/orientation via exifr w/ 0/0/1 fallback"
```

---

## Task 8: NetworkMonitor wrapper

**Files:**
- Create: `src/lib/mobile/network-monitor.ts`

- [ ] **Step 1: Implement** (no tests — pure Capacitor wrapper, smoke-verified on device)

Create `src/lib/mobile/network-monitor.ts`:

```ts
import { Network } from "@capacitor/network";

export class NetworkMonitor {
  private listenerHandle: { remove: () => Promise<void> } | null = null;

  async start(onOnline: () => void): Promise<void> {
    const status = await Network.getStatus();
    if (status.connected) onOnline();
    const handle = await Network.addListener("networkStatusChange", (s) => {
      if (s.connected) onOnline();
    });
    this.listenerHandle = handle;
  }

  async stop(): Promise<void> {
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mobile/network-monitor.ts
git commit -m "feat(65c): network-monitor — fire onOnline on init + on connectivity change"
```

---

## Task 9: UploadQueueWorker — core pipeline + tests

**Files:**
- Create: `src/lib/mobile/upload-queue.ts`
- Create: `src/lib/mobile/upload-queue.test.ts`

- [ ] **Step 1: Write failing tests for the worker's pure-logic pieces**

Create `src/lib/mobile/upload-queue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBackoffMs, isStaleUploadingClaim } from "./upload-queue";

describe("upload-queue pure logic", () => {
  describe("computeBackoffMs", () => {
    it("returns 1000 for retry_count 0", () => {
      expect(computeBackoffMs(0)).toBe(1000);
    });
    it("returns 5000 for retry_count 1", () => {
      expect(computeBackoffMs(1)).toBe(5000);
    });
    it("returns 30000 for retry_count 2", () => {
      expect(computeBackoffMs(2)).toBe(30000);
    });
    it("returns null for retry_count >= 3 (no further retries)", () => {
      expect(computeBackoffMs(3)).toBeNull();
      expect(computeBackoffMs(99)).toBeNull();
    });
  });

  describe("isStaleUploadingClaim", () => {
    it("true when state=uploading + owner != current pid", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "uploading", worker_owner_pid: "old-pid" } as any,
          "current-pid",
        ),
      ).toBe(true);
    });
    it("false when state=uploading + owner == current pid", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "uploading", worker_owner_pid: "current-pid" } as any,
          "current-pid",
        ),
      ).toBe(false);
    });
    it("false when state != uploading (regardless of owner)", () => {
      expect(
        isStaleUploadingClaim(
          { upload_state: "pending", worker_owner_pid: "old-pid" } as any,
          "current-pid",
        ),
      ).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test — fails**

```bash
npm test -- upload-queue
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement upload-queue.ts**

Create `src/lib/mobile/upload-queue.ts`:

```ts
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto-vault";
import { readDimensions } from "./exif-read";
import {
  deleteCapture,
  getEncryptedPhotoPath,
  getSidecarPath,
  readSidecar,
  updateSidecar,
} from "./capture-storage";
import type { CaptureSidecar, PendingCapture } from "./capture-types";

const ROOT = "pending-uploads";
const DIRECTORY = Directory.Documents;
const MAX_PARALLEL = 3;
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 30000] as const;
const ERROR_TRUNCATE_LEN = 200;

export type QueueItem = CaptureSidecar & {
  thumbnail_data_url?: string;
};

export interface QueueCounts {
  pending: number;
  uploading: number;
  failed: number;
  synced: number;
}

export interface DrainOptions {
  budgetMs?: number;
}

export interface UploadQueueDeps {
  supabase: SupabaseClient;
  organizationId: string;
  takenBy: string; // user_profiles.full_name (or email fallback)
  onChange: () => void; // emit when state mutates so React re-renders
}

export function computeBackoffMs(retryCount: number): number | null {
  if (retryCount >= MAX_RETRIES) return null;
  return BACKOFF_MS[retryCount];
}

export function isStaleUploadingClaim(
  s: Pick<CaptureSidecar, "upload_state" | "worker_owner_pid">,
  currentPid: string,
): boolean {
  return s.upload_state === "uploading" && s.worker_owner_pid !== currentPid;
}

export class UploadQueueWorker {
  private readonly thisPid: string;
  private deps: UploadQueueDeps;
  private inflight = 0;
  private items: Map<string, CaptureSidecar> = new Map();

  constructor(deps: UploadQueueDeps) {
    this.deps = deps;
    this.thisPid = crypto.randomUUID();
  }

  /** Re-scan disk; recover orphaned `uploading` claims from prior worker pids. */
  async scanAll(): Promise<void> {
    this.items.clear();
    const all = await listAllSidecars();
    for (const sc of all) {
      if (isStaleUploadingClaim(sc, this.thisPid)) {
        const recovered: CaptureSidecar = {
          ...sc,
          upload_state: "pending",
          worker_owner_pid: null,
        };
        await persistSidecar(recovered);
        this.items.set(sc.client_capture_id, recovered);
      } else {
        this.items.set(sc.client_capture_id, sc);
      }
    }
    this.deps.onChange();
  }

  counts(): QueueCounts {
    const c: QueueCounts = { pending: 0, uploading: 0, failed: 0, synced: 0 };
    for (const s of this.items.values()) c[s.upload_state]++;
    return c;
  }

  list(): CaptureSidecar[] {
    return [...this.items.values()].sort((a, b) =>
      a.taken_at.localeCompare(b.taken_at),
    );
  }

  async drain(opts: DrainOptions = {}): Promise<void> {
    const startedAt = Date.now();
    const budget = opts.budgetMs ?? Infinity;

    const eligible = (): CaptureSidecar[] =>
      [...this.items.values()].filter((s) => {
        if (s.upload_state === "pending") {
          if (s.last_attempt_at == null) return true;
          const due = new Date(s.last_attempt_at).getTime() +
            (computeBackoffMs(s.retry_count - 1) ?? 0);
          return Date.now() >= due;
        }
        return false;
      });

    while (Date.now() - startedAt < budget) {
      if (this.inflight >= MAX_PARALLEL) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const next = eligible()[0];
      if (!next) break;
      this.inflight++;
      this.uploadOne(next).finally(() => {
        this.inflight--;
      });
    }
    // Wait for inflight to settle before returning so the caller can rely on counts()
    while (this.inflight > 0) await new Promise((r) => setTimeout(r, 100));
  }

  async retry(captureId: string): Promise<void> {
    const s = [...this.items.values()].find(
      (x) => x.client_capture_id === captureId,
    );
    if (!s) return;
    const reset: CaptureSidecar = {
      ...s,
      upload_state: "pending",
      retry_count: 0,
      last_error: null,
      last_attempt_at: null,
      worker_owner_pid: null,
    };
    await persistSidecar(reset);
    this.items.set(captureId, reset);
    this.deps.onChange();
    await this.drain();
  }

  async deleteFromQueue(captureId: string): Promise<void> {
    const s = [...this.items.values()].find(
      (x) => x.client_capture_id === captureId,
    );
    if (!s) return;
    await deleteCapture(s.job_id, s.capture_session_id, captureId);
    this.items.delete(captureId);
    this.deps.onChange();
  }

  private async uploadOne(sidecar: CaptureSidecar): Promise<void> {
    const { job_id, capture_session_id, client_capture_id } = sidecar;

    // 1. claim
    const claimed: CaptureSidecar = {
      ...sidecar,
      upload_state: "uploading",
      worker_owner_pid: this.thisPid,
      last_attempt_at: new Date().toISOString(),
    };
    await persistSidecar(claimed);
    this.items.set(client_capture_id, claimed);
    this.deps.onChange();

    try {
      // 2. decrypt
      const encR = await Filesystem.readFile({
        path: getEncryptedPhotoPath(job_id, capture_session_id, client_capture_id),
        directory: DIRECTORY,
      });
      const encB64 =
        typeof encR.data === "string" ? encR.data : await blobToBase64(encR.data);
      const encBlob = new Blob([base64ToBuf(encB64)]);
      const blob = await decrypt(encBlob);

      // 3. EXIF
      const dims = await readDimensions(blob);

      // 4. upload to Supabase Storage
      const ext = "jpg";
      const ts = Date.now();
      const rand6 = Math.random().toString(36).slice(2, 8);
      const storagePath = `${this.deps.organizationId}/${job_id}/${ts}-${rand6}.${ext}`;

      const upload = async () =>
        this.deps.supabase.storage
          .from("photos")
          .upload(storagePath, blob, {
            contentType: "image/jpeg",
            upsert: false,
          });

      let upR = await upload();
      if (upR.error && (upR.error as any).status === 401) {
        await this.deps.supabase.auth.refreshSession();
        upR = await upload();
      }
      if (upR.error) throw upR.error;

      // 5. INSERT
      const ins = await this.deps.supabase.from("photos").insert({
        organization_id: this.deps.organizationId,
        job_id,
        storage_path: storagePath,
        uploaded_from: "mobile",
        client_capture_id,
        taken_by: this.deps.takenBy,
        taken_at: sidecar.taken_at,
        caption: sidecar.caption,
        width: dims.width,
        height: dims.height,
        file_size: blob.size,
      }).select("id").single();

      let photoId: string;
      if (ins.error && (ins.error as any).code === "23505") {
        // Unique-index conflict on (org, client_capture_id) — already uploaded.
        // Look up the existing row's id so we can still insert tag links.
        const { data } = await this.deps.supabase
          .from("photos")
          .select("id")
          .eq("organization_id", this.deps.organizationId)
          .eq("client_capture_id", client_capture_id)
          .single();
        if (!data) throw new Error("conflict_but_no_existing_row");
        photoId = data.id;
      } else if (ins.error) {
        throw ins.error;
      } else {
        photoId = ins.data!.id;
      }

      // 6. tag links
      if (sidecar.tag_ids.length > 0) {
        const rows = sidecar.tag_ids.map((tag_id) => ({
          organization_id: this.deps.organizationId,
          photo_id: photoId,
          tag_id,
        }));
        const t = await this.deps.supabase
          .from("photo_tag_assignments")
          .insert(rows);
        // Ignore tag-insert errors (RLS could vary); log only.
        if (t.error) console.warn("[65c] tag insert failed", t.error);
      }

      // 7. cleanup local files
      await deleteCapture(job_id, capture_session_id, client_capture_id);
      this.items.delete(client_capture_id);
      this.deps.onChange();
    } catch (err: any) {
      const errMsg = String(err?.message ?? err).slice(0, ERROR_TRUNCATE_LEN);
      const newRetryCount = sidecar.retry_count + 1;
      const nextState =
        computeBackoffMs(newRetryCount - 1) === null ? "failed" : "pending";
      const failed: CaptureSidecar = {
        ...sidecar,
        upload_state: nextState,
        retry_count: newRetryCount,
        last_error: errMsg,
        last_attempt_at: new Date().toISOString(),
        worker_owner_pid: null,
      };
      await persistSidecar(failed);
      this.items.set(client_capture_id, failed);
      this.deps.onChange();
    }
  }
}

// ---------- Module-level helpers ----------

async function listAllSidecars(): Promise<CaptureSidecar[]> {
  const out: CaptureSidecar[] = [];
  let jobDirs: string[] = [];
  try {
    const r = await Filesystem.readdir({ path: ROOT, directory: DIRECTORY });
    jobDirs = r.files.map((f) => (typeof f === "string" ? f : f.name));
  } catch {
    return out;
  }

  for (const jobDir of jobDirs) {
    const sessionsR = await Filesystem.readdir({
      path: `${ROOT}/${jobDir}`,
      directory: DIRECTORY,
    }).catch(() => ({ files: [] as Array<string | { name: string }> }));
    for (const sRaw of sessionsR.files) {
      const sess = typeof sRaw === "string" ? sRaw : sRaw.name;
      const filesR = await Filesystem.readdir({
        path: `${ROOT}/${jobDir}/${sess}`,
        directory: DIRECTORY,
      }).catch(() => ({ files: [] as Array<string | { name: string }> }));
      const names = filesR.files.map((f) => (typeof f === "string" ? f : f.name));
      const sidecarNames = names.filter((n) => n.endsWith(".json"));
      for (const name of sidecarNames) {
        const captureId = name.replace(/\.json$/, "");
        try {
          const sc = await readSidecar(jobDir, sess, captureId);
          out.push(sc);
        } catch {
          // skip damaged
        }
      }
    }
  }
  return out;
}

async function persistSidecar(s: CaptureSidecar): Promise<void> {
  await Filesystem.writeFile({
    path: getSidecarPath(s.job_id, s.capture_session_id, s.client_capture_id),
    data: JSON.stringify(s, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
```

Note: the `persistSidecar` `encoding` cast is a workaround; align it with the existing `Encoding.UTF8` import in `capture-storage.ts` style — `import { Encoding } from "@capacitor/filesystem"` then `encoding: Encoding.UTF8`.

- [ ] **Step 4: Run the pure-logic tests**

```bash
npm test -- upload-queue
```

Expected: 7 tests pass (4 backoff, 3 stale-claim).

- [ ] **Step 5: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean. If `updateSidecar` signature complaint surfaces, address in Task 9b.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mobile/upload-queue.ts src/lib/mobile/upload-queue.test.ts
git commit -m "feat(65c): upload-queue worker — claim/decrypt/EXIF/upload/INSERT/tag/cleanup pipeline"
```

---

## Task 9b: Loosen updateSidecar signature

**Files:**
- Modify: `src/lib/mobile/capture-storage.ts:121-136`

The existing `updateSidecar` only allows `caption` + `tag_ids`. The worker needs to update `upload_state`, `retry_count`, etc. Already addressed by switching to `persistSidecar` in worker, but `updateSidecar` itself should accept a broader patch for future callers + the orphan-recovery code.

- [ ] **Step 1: Replace updateSidecar in capture-storage.ts**

```ts
export async function updateSidecar(
  jobId: string,
  sessionId: string,
  captureId: string,
  patch: Partial<CaptureSidecar>,
): Promise<CaptureSidecar> {
  const current = await readSidecar(jobId, sessionId, captureId);
  const next: CaptureSidecar = { ...current, ...patch };
  await Filesystem.writeFile({
    path: getSidecarPath(jobId, sessionId, captureId),
    data: JSON.stringify(next, null, 2),
    directory: DIRECTORY,
    encoding: Encoding.UTF8,
  });
  return next;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mobile/capture-storage.ts
git commit -m "refactor(65c): loosen updateSidecar to Partial<CaptureSidecar> patch"
```

---

## Task 10: UploadQueueProvider context + hook

**Files:**
- Create: `src/lib/mobile/upload-queue-context.tsx`

- [ ] **Step 1: Implement provider + hook**

```tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { createClient } from "@/lib/supabase/client"; // confirm path matches repo
import { getActiveOrganizationId } from "@/lib/auth/active-org"; // confirm path
import { migrateUnencryptedFiles } from "./crypto-vault";
import { NetworkMonitor } from "./network-monitor";
import { UploadQueueWorker, type QueueCounts } from "./upload-queue";
import type { CaptureSidecar } from "./capture-types";

interface Ctx {
  counts: QueueCounts;
  list: CaptureSidecar[];
  retry: (captureId: string) => Promise<void>;
  deleteFromQueue: (captureId: string) => Promise<void>;
}

const UploadQueueContext = createContext<Ctx | null>(null);

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<QueueCounts>({
    pending: 0, uploading: 0, failed: 0, synced: 0,
  });
  const [list, setList] = useState<CaptureSidecar[]>([]);
  const workerRef = useRef<UploadQueueWorker | null>(null);
  const networkRef = useRef<NetworkMonitor | null>(null);

  useEffect(() => {
    let cancelled = false;
    let appStateHandle: { remove: () => Promise<void> } | null = null;

    (async () => {
      const supabase = createClient();
      const orgId = await getActiveOrganizationId(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // not signed in, no queue work
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();
      const takenBy = profile?.full_name || user.email || "unknown";

      // One-time migration of any pre-encryption 65b leftovers
      await migrateUnencryptedFiles().catch((e) =>
        console.warn("[65c] migration failed (non-fatal)", e),
      );

      const onChange = () => {
        if (cancelled || !workerRef.current) return;
        setCounts(workerRef.current.counts());
        setList(workerRef.current.list());
      };

      const worker = new UploadQueueWorker({
        supabase,
        organizationId: orgId,
        takenBy,
        onChange,
      });
      workerRef.current = worker;

      await worker.scanAll();
      onChange();
      worker.drain(); // fire-and-forget initial drain

      const network = new NetworkMonitor();
      await network.start(() => worker.drain());
      networkRef.current = network;

      appStateHandle = await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) worker.drain();
      });
    })();

    return () => {
      cancelled = true;
      networkRef.current?.stop();
      appStateHandle?.remove();
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      counts,
      list,
      retry: async (id) => workerRef.current?.retry(id),
      deleteFromQueue: async (id) => workerRef.current?.deleteFromQueue(id),
    }),
    [counts, list],
  );

  return (
    <UploadQueueContext.Provider value={value}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue(): Ctx {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueue must be used within UploadQueueProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify import paths**

`@/lib/supabase/client` and `@/lib/auth/active-org` are placeholders. Find the actual paths via:

```bash
grep -rn "createClient" src/lib/supabase 2>/dev/null | head -3
grep -rn "getActiveOrganizationId" src/lib/ 2>/dev/null | head -3
```

Replace the imports with the actual paths.

- [ ] **Step 3: Install @capacitor/app if not already present**

```bash
npm ls @capacitor/app
```

If missing:

```bash
npm install @capacitor/app
```

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile/upload-queue-context.tsx package.json package-lock.json
git commit -m "feat(65c): UploadQueueProvider + useUploadQueue hook; wires worker, network, app-state, migration"
```

---

## Task 11: UploadQueueBadge + CaptureFab integration

**Files:**
- Create: `src/components/mobile/upload-queue-badge.tsx`
- Modify: `src/components/mobile/capture-fab.tsx`

- [ ] **Step 1: Read capture-fab.tsx to understand current structure**

```bash
cat src/components/mobile/capture-fab.tsx
```

Note the existing button element + any positioning context. The badge needs `position: absolute` inside a `position: relative` parent.

- [ ] **Step 2: Implement UploadQueueBadge**

Create `src/components/mobile/upload-queue-badge.tsx`:

```tsx
"use client";

import { useUploadQueue } from "@/lib/mobile/upload-queue-context";

export function UploadQueueBadge() {
  const { counts } = useUploadQueue();
  const hasFailed = counts.failed > 0;
  const hasActive = counts.uploading + counts.pending > 0;

  if (!hasFailed && !hasActive) return null;

  const count = hasFailed ? counts.failed : counts.uploading + counts.pending;
  const color = hasFailed ? "bg-red-500" : "bg-blue-500";
  const animate = !hasFailed && counts.uploading > 0 ? "animate-pulse" : "";

  return (
    <span
      className={`absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full ${color} ${animate} text-white text-[11px] font-semibold flex items-center justify-center pointer-events-none shadow-md`}
      aria-label={
        hasFailed ? `${count} uploads failed` : `${count} uploading`
      }
    >
      {count}
    </span>
  );
}
```

- [ ] **Step 3: Wrap CaptureFab in relative container + mount badge + add long-press handler**

Modify `src/components/mobile/capture-fab.tsx`. Pattern: wrap the existing `<button>` in a `<div className="relative inline-block">`, mount `<UploadQueueBadge />` as a sibling, and add `onPointerDown`/`onPointerUp` handlers measuring 500ms threshold for long-press. On long-press, call `setSheetOpen(true)`.

Skeleton (adapt to existing component shape — do not blindly replace):

```tsx
"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { UploadQueueBadge } from "./upload-queue-badge";
import { UploadQueueSheet } from "./upload-queue-sheet";

const LONG_PRESS_MS = 500;

export function CaptureFab({ jobId }: { jobId: string }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function onPointerDown() {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  }
  function onPointerUp() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }
  function onClick(e: React.MouseEvent) {
    if (longPressFired.current) e.preventDefault();
  }

  return (
    <>
      <div className="relative inline-block">
        <Link
          href={`/jobs/${jobId}/capture`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          className="block w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center"
          aria-label="Open camera"
        >
          <Camera className="w-7 h-7" />
        </Link>
        <UploadQueueBadge />
      </div>
      <UploadQueueSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
```

Adapt to whatever the existing `CaptureFab` already looks like (existing styling, existing icon, existing nav target). The KEY changes are:
1. Outer `position: relative` container
2. `<UploadQueueBadge />` as sibling of the button
3. Long-press handlers
4. `<UploadQueueSheet>` mounted at the same level

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean (UploadQueueSheet doesn't exist yet — Task 12. Use a temp stub if blocking the build):

Temp stub at top of `upload-queue-sheet.tsx` if needed:

```tsx
"use client";
export function UploadQueueSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return null;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/mobile/upload-queue-badge.tsx src/components/mobile/capture-fab.tsx src/components/mobile/upload-queue-sheet.tsx
git commit -m "feat(65c): upload-queue badge on CaptureFab + long-press handler"
```

---

## Task 12: UploadQueueSheet bottom-sheet UI

**Files:**
- Modify: `src/components/mobile/upload-queue-sheet.tsx`

- [ ] **Step 1: Find the project's sheet/drawer primitive**

```bash
grep -rn "Drawer\|Sheet\|BottomSheet" src/components/ui/ 2>/dev/null | head -10
```

Use whichever primitive already exists (likely `<Drawer>` or `<Sheet>` from `vaul` or shadcn/ui). If none exists, fall back to a simple full-screen modal.

- [ ] **Step 2: Implement the sheet**

Replace the stub:

```tsx
"use client";

import { useUploadQueue } from "@/lib/mobile/upload-queue-context";
import { listSessionCaptures } from "@/lib/mobile/capture-storage";
import { useEffect, useState } from "react";
import type { CaptureSidecar } from "@/lib/mobile/capture-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadQueueSheet({ open, onOpenChange }: Props) {
  const { counts, list, retry, deleteFromQueue } = useUploadQueue();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      // Group by session for efficient listSessionCaptures call
      const sessions = new Map<string, CaptureSidecar[]>();
      for (const s of list) {
        const k = `${s.job_id}/${s.capture_session_id}`;
        if (!sessions.has(k)) sessions.set(k, []);
        sessions.get(k)!.push(s);
      }
      for (const [k, items] of sessions) {
        const [jobId, sessId] = k.split("/");
        const captures = await listSessionCaptures(jobId, sessId);
        for (const c of captures) {
          if (items.find((i) => i.client_capture_id === c.sidecar.client_capture_id)) {
            next[c.sidecar.client_capture_id] = c.thumbnail_data_url;
          }
        }
      }
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, list]);

  if (!open) return null;

  const failedItems = list.filter((s) => s.upload_state === "failed");

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={() => onOpenChange(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-h-[80vh] bg-white rounded-t-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold">Upload queue</h2>
          <button onClick={() => onOpenChange(false)} aria-label="Close">×</button>
        </div>
        {list.length === 0 ? (
          <div className="p-8 text-center text-gray-500">All synced</div>
        ) : (
          <ul className="divide-y">
            {list.map((s) => (
              <li key={s.client_capture_id} className="px-4 py-3 flex gap-3 items-start">
                {thumbs[s.client_capture_id] && (
                  <img
                    src={thumbs[s.client_capture_id]}
                    alt=""
                    className="w-16 h-16 rounded object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    Capture {new Date(s.taken_at).toLocaleTimeString()}
                  </div>
                  <div className="text-xs text-gray-600">
                    {s.upload_state === "uploading" && "Uploading…"}
                    {s.upload_state === "pending" && "Pending"}
                    {s.upload_state === "failed" &&
                      `Failed: ${s.last_error ?? "unknown error"}`}
                  </div>
                  {s.upload_state === "failed" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => retry(s.client_capture_id)}
                        className="text-xs px-3 py-1 rounded bg-blue-600 text-white"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => deleteFromQueue(s.client_capture_id)}
                        className="text-xs px-3 py-1 rounded border border-gray-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {failedItems.length > 1 && (
          <div className="sticky bottom-0 bg-white border-t p-3">
            <button
              onClick={() => Promise.all(failedItems.map((s) => retry(s.client_capture_id)))}
              className="w-full py-2 rounded bg-blue-600 text-white"
            >
              Retry all failed ({failedItems.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/mobile/upload-queue-sheet.tsx
git commit -m "feat(65c): upload-queue sheet — list w/ retry / delete / retry-all-failed"
```

---

## Task 13: Wire UploadQueueProvider into mobile layout

**Files:**
- Modify: `src/app/(mobile)/...` layout file (find via grep)

- [ ] **Step 1: Find the mobile root layout**

```bash
ls src/app/\(mobile\)/ 2>/dev/null
find src/app -name "layout.tsx" | xargs grep -l "mobile\|capture" 2>/dev/null
```

Use the layout that wraps all mobile (Capacitor-only) routes. If none exists yet, the provider can wrap just `(mobile)/jobs/[id]/capture/layout.tsx` PLUS the job-detail page itself (where the FAB lives).

The minimum scope: `<UploadQueueProvider>` must wrap ANY page that renders `<CaptureFab>` AND the capture page itself. If `CaptureFab` lives in `job-detail.tsx`, that page's layout needs the provider.

Actually simpler: wrap at the topmost `(app)` layout if `(mobile)` is not its own segment. Verify by reading the Next 16 routing structure in this repo.

- [ ] **Step 2: Wrap children**

Wherever the right layout is, modify:

```tsx
import { UploadQueueProvider } from "@/lib/mobile/upload-queue-context";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <UploadQueueProvider>{children}</UploadQueueProvider>;
}
```

If the layout already has a provider tree, nest it inside the auth-providing one (the worker needs an authed Supabase client).

- [ ] **Step 3: Verify provider only mounts in Capacitor environments**

The provider's effect contains `App.addListener` which throws on web. Either:
- Gate the entire effect on `Capacitor.isNativePlatform()` from `src/lib/mobile/use-capacitor.ts`, OR
- Wrap the App import in try/catch, OR
- Only mount the provider in routes that are Capacitor-only

Cleanest: gate the effect:

```ts
import { Capacitor } from "@capacitor/core";

useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  // ... existing effect body
}, []);
```

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile/upload-queue-context.tsx src/app/<layout-path>/layout.tsx
git commit -m "feat(65c): mount UploadQueueProvider in mobile layout (Capacitor-only)"
```

---

## Task 14: Background sync — install plugin + Info.plist + handler

**Files:**
- Create: `src/lib/mobile/background-sync.ts`
- Modify: `ios/App/App/Info.plist`
- Modify: `src/lib/mobile/upload-queue-context.tsx` (wire bg-sync)

- [ ] **Step 1: Confirm @capacitor/background-task installed (Task 1)**

```bash
npm ls @capacitor/background-task
```

- [ ] **Step 2: Implement background-sync.ts**

```ts
import { BackgroundTask } from "@capacitor/background-task";
import { App } from "@capacitor/app";

export class BackgroundSyncRunner {
  private listenerHandle: { remove: () => Promise<void> } | null = null;

  async start(onWake: (budgetMs: number) => Promise<void>): Promise<void> {
    this.listenerHandle = await App.addListener("appStateChange", async ({ isActive }) => {
      if (isActive) return;
      // App went to background. Schedule a finite background task.
      const taskId = await BackgroundTask.beforeExit(async () => {
        try {
          await onWake(8000);
        } finally {
          BackgroundTask.finish({ taskId });
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.listenerHandle) {
      await this.listenerHandle.remove();
      this.listenerHandle = null;
    }
  }
}
```

Note: `@capacitor/background-task` API exposes `beforeExit` for finishing in-flight work when app is suspended. For true background-fetch wake-ups (system-scheduled), iOS requires `BGTaskScheduler` registration which Capacitor's plugin does not yet wrap. For 65c: rely on `beforeExit` to drain when the user backgrounds the app, plus `appStateChange → isActive=true` to drain on return-to-foreground (already wired in Task 10). True system-scheduled wake-ups can be added later via a custom Swift plugin.

If Eric wants true `BGTaskScheduler` wake-ups now, that's a separate sub-task (~50 lines of Swift in `ios/App/App/AppDelegate.swift` + plugin-bridge code). Flagged in spec risks. Plan as written ships beforeExit + foreground-on-resume.

- [ ] **Step 3: Wire into UploadQueueProvider**

Modify `src/lib/mobile/upload-queue-context.tsx` effect — add `BackgroundSyncRunner`:

```ts
import { BackgroundSyncRunner } from "./background-sync";

// inside the effect, after networkRef.current setup:
const bgSync = new BackgroundSyncRunner();
await bgSync.start((budgetMs) => worker.drain({ budgetMs }));
bgSyncRef.current = bgSync;

// in cleanup:
bgSyncRef.current?.stop();
```

Add `bgSyncRef` ref alongside `networkRef`.

- [ ] **Step 4: Modify Info.plist for background-fetch entitlement**

```bash
plutil -insert UIBackgroundModes -xml '<array><string>fetch</string></array>' ios/App/App/Info.plist
plutil -lint ios/App/App/Info.plist
```

Expected: `OK`.

- [ ] **Step 5: cap sync ios**

```bash
npx cap sync ios
```

Expected: `Found N Capacitor plugins for ios` (where N = previous count + the new ones from Task 1 + bg-task). Plugins listed should include `@capacitor/background-task`, `@capacitor/network`, the chosen Keychain plugin.

- [ ] **Step 6: Verify Package.swift looks right**

```bash
git diff ios/App/CapApp-SPM/Package.swift
```

Expected: net additions for the new plugins. No unexplained deletions. Should match the cap-sync-managed pattern (memory: `project_capacitor_plugins_npm_declaration.md`).

- [ ] **Step 7: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mobile/background-sync.ts src/lib/mobile/upload-queue-context.tsx ios/App/App/Info.plist ios/App/CapApp-SPM/Package.swift
git commit -m "feat(65c): background-sync — beforeExit drain + Info.plist UIBackgroundModes:fetch"
```

---

## Task 15: Push to remote, open PR, wait for Vercel preview

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
git push -u origin build-65c-upload-pipeline
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "Build 65c: mobile upload pipeline + offline queue" --body "$(cat <<'EOF'
## Summary
- Drains 65b camera-scaffold's `pending-uploads/{job}/{session}/` files to Supabase Storage + `photos` table
- AES-256-GCM encryption-at-rest with key in iOS Keychain
- 3-retry exp backoff (1s/5s/30s); failures surface in FAB-badge + queue sheet
- iOS background-task drain on app backgrounding; foreground-on-resume drain
- Idempotency via partial unique index on `(organization_id, client_capture_id)`
- In-pass fix: web `photo-upload.tsx` writes `uploaded_from='web'` + real `taken_by`

Spec: docs/superpowers/specs/2026-05-08-build-65c-upload-pipeline-design.md
Plan: docs/superpowers/plans/2026-05-08-build-65c-upload-pipeline.md

## Test plan
- [ ] Vercel preview builds clean
- [ ] On iPhone (TestFlight or local install): all 19 tests in spec §Testing
- [ ] Migration applied to AAA prod, advisors clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for Vercel preview SUCCESS**

```bash
gh pr checks --watch
```

Expected: all checks green. If Vercel build fails, fix inline before proceeding (most likely failures: import path mismatches, missing env at build time, SSR-vs-client misuse of Capacitor APIs).

---

## Task 16: Real-device smoke — install build, run test list

**Files:** none (verification).

- [ ] **Step 1: Install latest build on Eric's iPhone**

The iPhone Capacitor app loads `aaaplatform.vercel.app` directly per `capacitor.config.ts:9` `server.url`. After PR merge, the app reflects new web code via force-quit + reopen. BUT the new native deps (background-task, network, secure-storage plugins) require a NEW NATIVE BUILD shipped to TestFlight or Xcode-installed.

Path options:
- **Wait for merge → Xcode Cloud archive → TestFlight** (cleanest)
- **Local Xcode install** (`npx cap open ios` → run on Eric's iPhone via USB) — faster for smoke

For smoke, do local Xcode install on Eric's iPhone before merging. This validates the native side ships correctly before anyone else gets the build.

```bash
npx cap open ios
```

Then in Xcode: select Eric's iPhone as target, hit Run. If first install, accept the trust dialog on iPhone (Settings → General → VPN & Device Management).

- [ ] **Step 2: Sign in as Eric's normal user**

Open Nookleus on iPhone, sign in. Confirm normal session works.

- [ ] **Step 3: Create a fresh test job**

In the app, create a new job titled "65c smoke 2026-05-08" (or via web if mobile job-create is not yet built). Note the job's UUID for later cleanup.

- [ ] **Step 4: Test 1 — capture 50 with signal**

Open job, tap FAB, snap 50 photos in rapid mode. Exit camera. Watch FAB badge count down to 0 within ~5 minutes.

If badge stuck or count wrong: Xcode console for worker logs.

- [ ] **Step 5: Test 2 — airplane mode + 100 captures**

Enable airplane mode. Snap 100 photos. Exit camera. Confirm badge shows 100 pending. Disable airplane. Watch drain.

- [ ] **Step 6: Test 3-5 — failure path**

To trigger a synthetic failure: temporarily block the `photos` storage bucket from accepting uploads via Supabase MCP storage policy edit (or rotate the storage bucket name client-side via a localStorage flag). Capture 3 photos, watch retries → failed. Open queue sheet, retry one (should succeed after policy reverted), delete one, leave one as orphan-failed for cleanup.

Revert the policy edit after the test.

- [ ] **Step 7: Test 6 — app killed mid-upload**

Start a drain (capture 20, watch them upload). Mid-drain, force-quit Nookleus. Reopen. Sidecars w/ `upload_state='uploading'` should reset to `pending` on `scanAll()`; drain resumes.

- [ ] **Step 8: Test 7 — background-task drain**

Capture 20. Swipe up to background Nookleus. Switch to Notes app. Wait 30s. Return to Nookleus → expect badge progress made. (`beforeExit` drains for ~10s after backgrounding; with 20 photos at ~3-parallel × 1s each = ~7s, should mostly clear.)

- [ ] **Step 9: Test 8 — Xcode device-files encryption check**

In Xcode → Window → Devices and Simulators → Eric's iPhone → Installed Apps → Nookleus → Container → ⚙️ → Download Container. Open the downloaded `.xcappdata` (right-click → Show Package Contents) → AppData/Documents/pending-uploads/ → grab a `.jpg.enc` file → `xxd <file> | head` → should show random bytes (not the JPEG `\xff\xd8\xff` magic).

- [ ] **Step 10: Test 9 — idempotency**

Pick a synced photo, manually re-create its sidecar (copy a previous sidecar JSON that's been deleted post-sync — easiest via the Xcode container download then upload-back), watch worker detect it on next scan, attempt INSERT, hit unique-index conflict, treat as success, clean up local file. SELECT in Supabase MCP — only one row.

This test is fiddly; if it's hard to set up the re-creation, skip and rely on the unit test for `23505` handling.

- [ ] **Step 11: Tests 10-12 — DB column verification**

Via Supabase MCP `execute_sql`:

```sql
SELECT id, taken_by, uploaded_from, organization_id, client_capture_id, width, height, file_size
  FROM public.photos
 WHERE job_id = '<test job UUID>'
 ORDER BY created_at DESC LIMIT 10;
```

Expected: `uploaded_from='mobile'`, `taken_by='Eric Daniels'` (or whatever full_name is), `organization_id` = AAA's UUID, `client_capture_id` populated, `width`/`height` non-zero (if EXIF read worked), `file_size` populated.

- [ ] **Step 12: Tests 13-17 — platform integrations on web**

Open web at `aaaplatform.vercel.app` (Vanessa's MacBook Chrome). For test job:
- `/jobs/<uuid>` photos tab → mobile-captured photos visible
- `/photos` global gallery → mobile photos visible at top
- Open one in annotation editor → draw an arrow, save
- Drag two together as a before/after pair
- Run a photo report including the test job → mobile photos appear

- [ ] **Step 13: Tests 18-19 — web in-pass fix verification**

Open `/jobs/<test job>` on web, drag a photo into the existing upload modal, save. SELECT same photo:

```sql
SELECT taken_by, uploaded_from FROM public.photos WHERE storage_path LIKE '%<filename>%';
```

Expected: `taken_by='Eric Daniels'`, `uploaded_from='web'`.

- [ ] **Step 14: Document smoke results**

Add a section to the PR body via `gh pr edit`:

```
## Smoke results (real-device, AAA prod, 2026-05-08)
| # | Test | Result |
| 1 | 50 photos w/ signal | ✅ drained in <5min |
| ... | ... | ... |
```

---

## Task 17: Cleanup test data + merge + TestFlight push

**Files:** none.

- [ ] **Step 1: Clean test job's photos via web UI batch-delete**

Open `/jobs/<test job UUID>` photos tab → select all → delete. Should cascade-delete `photo_tag_assignments` + storage objects via the platform's existing delete path.

If any orphan storage blobs:

```sql
-- Via Supabase MCP execute_sql, list orphans:
SELECT name FROM storage.objects WHERE bucket_id='photos' AND name LIKE '<org-uuid>/<job-uuid>/%';
-- Bulk delete: requires SET LOCAL storage.allow_delete_query='true' admin escape per 15d Task 29 pattern
```

- [ ] **Step 2: Delete the test job itself**

Via web UI or SQL.

- [ ] **Step 3: Merge PR**

```bash
gh pr merge --merge  # or --squash per repo convention
```

- [ ] **Step 4: Trigger Xcode Cloud archive**

Push to main triggers Xcode Cloud workflow per [[2026-05-08-build-65b-xcode-cloud-fix]]. Wait for build green:

```bash
# Wait for App Store Connect email or check via:
gh run list --workflow ios-archive  # if such a workflow exists
```

If Xcode Cloud workflow needs manual nudge, do it from App Store Connect.

- [ ] **Step 5: TestFlight install on Eric's iPhone**

Once Xcode Cloud archive succeeds + processes for TestFlight (~10-30 min), Eric installs from TestFlight, re-runs a quick smoke (3-5 captures, watch them upload).

- [ ] **Step 6: Run handoff skill**

```bash
# Invoke /handoff or end-of-session-handoff skill
```

This writes `docs/vault/handoffs/2026-05-08-build-65c-upload-pipeline.md` and updates `docs/vault/00-NOW.md`.

---

## Self-review checklist

After completing all tasks:

- [ ] Migration applied; advisors clean
- [ ] All 19 spec smoke tests pass on real device
- [ ] No orphan storage blobs from test job
- [ ] Web `photo-upload.tsx` in-pass fix verified for both `taken_by` + `uploaded_from`
- [ ] PR merged, Xcode Cloud green, TestFlight installed
- [ ] Handoff doc written
- [ ] Vault `00-NOW.md` updated to mark 65c shipped

---

## Notes for the executor

- **Auto-mode policy:** spec sequencing prefers prod over scratch (single-session). Don't propose A/B/C splits.
- **Direct pushes to main:** the harness's auto-mode classifier blocks direct pushes; use PR route. Eric authorizes via the `! git push origin main` slash-command escape hatch only for hotfix follow-ups.
- **Capacitor SPM Package.swift:** never hand-edit. Always regenerate via `npx cap sync ios` after npm-declaring a new plugin (memory: `project_capacitor_plugins_npm_declaration.md`).
- **Xcode Cloud Node:** `ios/App/ci_scripts/ci_post_clone.sh` already installs Node via brew (memory: `project_xcode_cloud_node_brew.md`); no change needed for 65c.
- **Test data live on prod:** there are no real customers (memory: `project_no_real_customers_yet.md`); cleanup is straightforward but should still be done so future analytics aren't polluted.
- **Owner-PID race notes:** the worker's pid is regenerated per app launch (per `UploadQueueProvider` mount). On fast hot-reload during development, you'll get fresh pids constantly — that's expected.
