# Email Sync Speedup & Multi-Account Indicators

**Date:** 2026-05-13
**Scope:** Make `/api/email/sync` finish in <2s (foreground). Add per-account color indicator in `/email`.

## Goals

1. **Manual Sync button finishes in under 2 seconds in steady state.** Today it routinely takes 5–30+ seconds because it does five different jobs in one HTTP request.
2. **Auto-sync on page load is silent** (no spinner). Page lands → existing mail visible → new mail slips in within ~2s.
3. **Each email row shows which account it belongs to** via a colored bar on its left edge — but only when 2+ active accounts are connected.

## Non-Goals

- **Optimizing the one-time historical backfill.** It only runs when `category_backfill_completed_at IS NULL` on `email_accounts` — i.e., once per newly-added account, ever. Out of scope.
- **Page-load query optimizations** (the `/counts` 14-sequential-query problem, the `select("*")` on `/list`, missing composite indexes). Real wins but the user identified sync as the pain. Defer.
- **Real-time push (IMAP IDLE).** Auto-sync + lazy per-tab refresh is enough for now.
- **A queue table / cron worker.** The QuickBooks pattern is overkill here.

## Current State

`/api/email/sync` (POST, body `{ accountId }`) does five jobs in a single foreground HTTP request:

1. One-time category backfill (Pass 1: re-categorize all DB rows; Pass 2: re-fetch IMAP headers for up to 500 stragglers). Runs only on first sync per account.
2. Open every IMAP folder in a 17-name list, fetch the last 100 messages by sequence number, parse each with `simpleParser`.
3. Dedup new messages against a *full* in-memory set of every `message_id` already stored for that folder.
4. Batch-insert new rows; categorize and job-match each as it goes.
5. For each new email with attachments, upload each attachment to Supabase Storage one at a time, then insert `email_attachments` rows.

Client (`src/components/email-inbox.tsx`) calls this `for (acc of toSync) { await fetch(sync) }` — sequential per account.

Result: with N accounts × ~5 actual folders × 100 messages, the spinner sits for a long time. Auto-sync on mount inherits the same cost.

## Design

### 1. UID Bookmark — incremental fetch

**The core idea.** Stop re-fetching the last 100 messages every sync. Instead, remember the highest IMAP UID we've seen per (account, folder), and ask the server "give me UIDs greater than X." If nothing's new, the round-trip is empty.

**Schema.** New table:

```sql
CREATE TABLE email_folder_state (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  folder text NOT NULL,                 -- normalized folder name (inbox, sent, drafts, etc.)
  imap_path text NOT NULL,              -- the actual IMAP path we opened (e.g. "[Gmail]/Sent Mail")
  uid_validity bigint NOT NULL,         -- IMAP UIDVALIDITY of the mailbox at last sync
  last_uid_seen bigint NOT NULL,        -- highest UID we've ingested
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, folder)
);

CREATE INDEX idx_email_folder_state_org ON email_folder_state(organization_id);
ALTER TABLE email_folder_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_folder_state ON email_folder_state
  USING (organization_id = (SELECT organization_id FROM users WHERE id = auth.uid()));
```

We use a separate table rather than columns on `email_accounts` because folder count varies per account and we want to add/remove folders cheaply.

**Sync algorithm per folder.**

```
mailbox = client.mailboxOpen(imapPath, { readOnly: true })
storedValidity, storedUid = (state row for this account+folder, or null)

if storedValidity is null:
  # First sync of this folder — bootstrap.
  Fetch last 50 messages by sequence number, dedup by message_id against DB (small targeted query, see below).
  Insert new rows.
  Write state row with mailbox.uidValidity and the max UID seen.
  Return.

if mailbox.uidValidity !== storedValidity:
  # Mail server reassigned UIDs (rare). Treat like bootstrap above.
  Delete the stored state row, fall through to bootstrap path.
  Log a structured warning so we can see how often this happens.

# Steady state — the fast path.
range = (storedUid + 1) + ":*"
messages = client.fetch(range, { uid: true, envelope: true, source: true, bodyStructure: true }, { uid: true })

if no messages: done in one round-trip.

For each message:
  parse, categorize, job-match, prepare row
Batch insert. Update state row: last_uid_seen = max(uid), last_synced_at = now().
```

**Targeted dedup on bootstrap only.** Today we pull *every* `message_id` for the account+folder upfront. Replace with: after fetching the bootstrap candidates, look up just those specific `message_id`s in one query. Most accounts in steady state will never bootstrap a folder twice.

**Files changed:**
- `supabase/migration-build-<N>-email-folder-state.sql` — new table + RLS policy
- `src/app/api/email/sync/route.ts` — replace sequence-based fetch with UID bookmark logic
- `src/lib/types.ts` — `EmailFolderState` type

### 2. Fast path: Inbox + Sent only

The Sync button (manual or auto) only checks the **Inbox** and **Sent** folders.

The 17-name folder list in `SYNC_FOLDERS` shrinks to two normalized names: `inbox` and `sent`. For each, we resolve to the actual IMAP path using the folder discovery we already do (`client.list()`).

Other folders (Drafts, Trash, Spam, Archive) are not touched during Sync. They're handled by the lazy per-tab refresh in §4.

**Estimated budget (steady state, no new mail):**
- Connect + auth: ~400 ms
- Inbox: open + UID check + close: ~200 ms
- Sent: open + UID check + close: ~200 ms
- Logout: ~100 ms
- **Total ~900 ms** for an empty sync. With 0–5 new emails, adds ~200–500 ms.

### 3. Parallel multi-account

Client today: `for (const acc of toSync) { await fetch(... sync ...) }`.

Change to `Promise.all(toSync.map(acc => fetch(...)))`. Each account's sync is fully independent — different IMAP connection, different mailbox, no shared state during the request. The server route handles one account per request, so no server-side changes for this. Total time becomes `max(per-account)` not `sum(per-account)`.

**Files changed:**
- `src/components/email-inbox.tsx` — `handleSync()` swaps `for…of await` for `Promise.all`. Aggregate `totalSynced` and surface a per-account error toast on any rejection without blocking the others.

### 4. Lazy per-tab refresh

Drafts, Trash, Spam, Archive don't sync on the Sync button. They sync when the user clicks the corresponding tab in the icon rail (or otherwise navigates to that folder).

**New endpoint:** `POST /api/email/sync-folder`

Request: `{ accountId?: string, folder: "drafts" | "trash" | "spam" | "archive" | "sent" | "inbox" }`. If `accountId` is omitted, syncs all active accounts for that folder in parallel.

Internally calls the same per-folder sync logic from §1 — bookmark check, fetch new UIDs, insert rows, update state. No backfill, no attachment work other than what §5 specifies.

**Client behavior.** When `handleFolderChange(key)` runs in `email-inbox.tsx`:

1. Set `folder = key` (renders existing rows immediately from current state).
2. Kick off `fetch('/api/email/sync-folder', { folder: key, accountId: selectedAccountId || undefined })` in the background.
3. When it resolves, call `loadEmails()` and `loadCounts()` to pick up any new rows.

Show existing data immediately. Update silently when the sync finishes. No spinner.

**Throttle.** Skip the background fetch if `last_synced_at` for that folder (any account) was within the last 30 seconds. Prevents tab-flip thrash.

**Files changed:**
- `src/app/api/email/sync-folder/route.ts` — new endpoint
- `src/components/email-inbox.tsx` — wire `handleFolderChange` to fire the sync-folder request

### 5. Attachments out of the hot path

Today: each attachment is uploaded and `email_attachments` row inserted *before* the sync response returns.

Change: the sync route saves email rows synchronously, returns the response, then continues uploading attachments via Next.js `after()` from `next/server`. The function instance stays alive long enough on Vercel Fluid Compute to finish the uploads.

```ts
import { after } from 'next/server';

// ... inside POST handler, after batch insert ...

if (emailsWithAttachments.length > 0) {
  after(async () => {
    for (const { emailId, parsedAttachments } of emailsWithAttachments) {
      await Promise.all(parsedAttachments.map(att => uploadOne(emailId, att)));
    }
  });
}

return NextResponse.json({ ... });
```

Within `after()`, attachments per email upload in parallel (`Promise.all`). The for-loop is across emails, not within an email.

**UI for the in-flight case.** `EmailReader` already fetches attachments when an email is opened. Add: if `has_attachments` is true on the email row but the `email_attachments` query returns zero rows, show a `Loading attachments…` row that polls once after 1.5s. After that, show whatever's there. In practice this state rarely renders — only if the user opens a brand-new email within ~3s of sync responding.

**Files changed:**
- `src/app/api/email/sync/route.ts` — move attachment uploads inside `after()`
- `src/components/email-reader.tsx` — render a one-time `Loading attachments…` placeholder when `has_attachments && attachments.length === 0`

### 6. Auto-sync on mount, silently

Today: auto-sync runs `handleSync()`, which sets `syncing=true` → spinner appears. It already debounces with a 60-second check against the most recent `last_synced_at` across accounts. Keep that debounce.

Change: introduce `handleSyncSilent()` that does the same fetch but doesn't toggle the visible `syncing` state. The in-flight promise is tracked via the `inFlightSync` ref defined in §7 so a manual click can promote it.

After the silent sync resolves: `loadEmails()` + `loadCounts()` — same as today — and update the "Last synced" indicator (§8).

If silent sync fails: don't toast, just mark the indicator as failed (§8).

**Files changed:**
- `src/components/email-inbox.tsx` — split `handleSync()` into `handleSyncSilent()` and `handleSyncVisible()`. Auto-sync useEffect calls the silent one. Sync button calls the visible one with the concurrent-click promotion in §7.

### 7. Concurrent click: promote silent to visible

If the user clicks Sync while `autoSyncInFlight` is true:

1. Don't fire a second request.
2. Set `syncing = true` so the spinner appears immediately.
3. Wait on the existing in-flight `Promise`. When it resolves (or rejects), unset `syncing` and update the indicator.

Implementation: store the in-flight `Promise` in a ref. When the button handler runs, if the ref is set, `await` it instead of firing a new fetch.

```ts
const inFlightSync = useRef<Promise<void> | null>(null);

async function handleSyncVisible() {
  setSyncing(true);
  try {
    if (inFlightSync.current) {
      await inFlightSync.current; // promote the silent one
    } else {
      inFlightSync.current = doSyncWork();
      await inFlightSync.current;
    }
  } finally {
    inFlightSync.current = null;
    setSyncing(false);
  }
}

async function handleSyncSilent() {
  if (inFlightSync.current) return; // already running
  inFlightSync.current = doSyncWork();
  try { await inFlightSync.current; } finally { inFlightSync.current = null; }
}
```

### 8. "Last synced" indicator

A small text element to the left of the Sync button. Three states:

- **Idle, success:** `Last synced: just now` / `2 min ago` / `1 hr ago`. Updates via a `useEffect` interval that ticks every 30s recomputing the relative time.
- **In flight:** `Syncing…` while spinner is up.
- **Failed:** `Sync failed — retry` in red, click acts as retry.

The timestamp source is the latest `last_synced_at` across all `email_accounts` for the selected scope (single account vs All Inboxes).

**Files changed:**
- `src/components/email-inbox.tsx` — add `LastSyncedIndicator` subcomponent rendered before the Sync button.

### 9. Per-account color indicator

**Schema.** Add `color` column to `email_accounts`:

```sql
ALTER TABLE email_accounts ADD COLUMN color text;
-- Backfill existing accounts by add-order using the palette:
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at) AS rn
  FROM email_accounts WHERE color IS NULL
)
UPDATE email_accounts ea
SET color = CASE (SELECT rn FROM ranked WHERE id = ea.id) - 1
  WHEN 0 THEN '#0F6E56' -- Nookleus green
  WHEN 1 THEN '#2563EB' -- blue-600
  WHEN 2 THEN '#D97706' -- amber-600
  WHEN 3 THEN '#7C3AED' -- violet-600
  WHEN 4 THEN '#E11D48' -- rose-600
  ELSE '#6B7280'        -- gray-500 fallback
END
WHERE color IS NULL;
```

**Auto-assign on new-account creation.** When `POST /api/email/accounts` inserts a new account and `color` is unset, pick the lowest-indexed palette color not already used by this organization. Fall back to gray-500 if all five are taken.

**Settings override.** Add a small color-swatch picker on each account row in `/settings/email`. Five preset swatches + a hex input. PATCH updates the column.

**Row rendering.** In `EmailRow` inside `email-inbox.tsx`, add a 3px-wide colored bar at the left edge of the row when there are 2+ active accounts. Hidden when only one active account exists.

`EmailRow` doesn't currently know about accounts. Pass it the resolved color as a prop. In `EmailInbox`, derive a `Map<string, string>` of `account_id → color` from the already-loaded `accounts` state, and look up each row's color before passing to `EmailRow`. Also pass `showAccountBar` (= `activeAccounts.length >= 2`) so `EmailRow` can decide whether to render at all.

```tsx
{showAccountBar && (
  <div
    className="absolute left-0 top-0 bottom-0 w-[3px]"
    style={{ backgroundColor: accountColor ?? "#6B7280" }}
  />
)}
```

The reading pane header (`EmailReader`) also displays the same bar above its account label.

The list API currently returns `account_id` per row. No API change needed; we already fetch accounts and can map client-side.

**Files changed:**
- `supabase/migration-build-<N>-email-account-color.sql` — column + backfill
- `src/app/api/email/accounts/route.ts` — auto-assign on create
- `src/app/settings/email/page.tsx` — color picker per account row
- `src/components/email-inbox.tsx` — render the left bar in `EmailRow`, conditional on `activeAccounts.length >= 2`
- `src/components/email-reader.tsx` — render the bar in the reader header

## Data flow recap

**Manual Sync click (steady state):**
1. Button clicked → `setSyncing(true)` → spinner appears.
2. If silent sync in flight, await its promise. Otherwise fire `POST /api/email/sync` per account in parallel.
3. Each route: connect, open Inbox, UID range `>= last_uid_seen + 1`, fetch + insert. Same for Sent.
4. Route returns after rows inserted; attachments continue in `after()`.
5. Client: `setSyncing(false)`, `loadEmails()`, `loadCounts()`, `LastSyncedIndicator` updates.

**Tab switch (e.g., click Drafts):**
1. `handleFolderChange("drafts")` → `setFolder("drafts")` → existing drafts render immediately.
2. Background `POST /api/email/sync-folder` (folder=drafts) per account in parallel, unless throttled.
3. On resolve: `loadEmails()` + `loadCounts()`.

**Page mount:**
1. Existing list/counts/accounts fetches as today.
2. Silent auto-sync fires once (≥60s since last sync) using same code as manual click but no spinner.
3. On resolve: list/counts re-fetch, indicator updates.

## Edge cases

- **UIDVALIDITY changes mid-life of an account.** Detect on each sync. Wipe the state row, treat as bootstrap. Log it.
- **Mailbox renamed/deleted on server.** Open fails → `try/catch` skips that folder for this sync. State row stays; will retry next time.
- **Attachment upload fails after response sent.** Today's behavior is silent skip; keep that. The `has_attachments` flag stays true on the row; user opening the email sees the `Loading attachments…` placeholder briefly, then nothing. A future iteration can add a server-side retry queue. Out of scope here.
- **User clicks Sync rapidly during an in-flight sync.** Subsequent clicks await the same promise via the ref pattern in §7. No multiplied work.
- **Hostinger / Network Solutions servers without UIDPLUS or CONDSTORE.** UID + UIDVALIDITY are baseline IMAP4rev1 — supported everywhere. We don't need CONDSTORE/MODSEQ for this design.

## Migration sequencing

1. Migration A: `email_folder_state` table.
2. Migration B: `email_accounts.color` column + backfill.
3. Code changes can ship as one PR; the migrations apply first.

> Migration filenames use `migration-build-<N>-*.sql` — the actual build number is assigned when the migration is created, matching the repo's existing convention (see `supabase/migration-build45-*.sql` etc.).

## Files touched (summary)

**Backend:**
- `src/app/api/email/sync/route.ts` — UID bookmark, Inbox+Sent only, attachments in `after()`
- `src/app/api/email/sync-folder/route.ts` — new endpoint for lazy tab refresh
- `src/app/api/email/accounts/route.ts` — color auto-assign on create
- `supabase/migration-build-<N>-email-folder-state.sql`
- `supabase/migration-build-<N>-email-account-color.sql`

**Frontend:**
- `src/components/email-inbox.tsx` — parallel multi-account, silent auto-sync, `LastSyncedIndicator`, concurrent-click promotion, lazy per-tab refresh, account color bar
- `src/components/email-reader.tsx` — `Loading attachments…` placeholder, account color bar in header
- `src/app/settings/email/page.tsx` — color picker per account row

**Types:**
- `src/lib/types.ts` — `EmailFolderState`, `EmailAccount.color`
