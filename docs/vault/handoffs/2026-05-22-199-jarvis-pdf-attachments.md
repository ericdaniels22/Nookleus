---
date: 2026-05-22
build_id: 199
session_type: focused
machine: TheLaunchPad
related: ["[[2026-05-22-198-jarvis-chat-attachments]]"]
---

# Build 199 Handoff — 2026-05-22

## What shipped this session

Implemented issue [#199](https://github.com/ericdaniels22/Nookleus/issues/199)
— **PDF support for Jarvis Chat attachments**, the next slice of parent
[#153](https://github.com/ericdaniels22/Nookleus/issues/153) ("Chat
attachments for Jarvis"), built straight on top of the #198 image spine. A
user in Jarvis Core can attach **one PDF** (up to 32 MB) to a message: it
is validated, stored in the `jarvis-attachments` bucket, uploaded **once**
to the Anthropic Files API, and referenced by `file_id` on every replay so
it is never re-encoded; Jarvis Core can answer questions about it; it
renders as a **labelled chip** (not a thumbnail) in the chat input and in
the user's message bubble. Built via `/tdd` in an isolated worktree
(`.claude/worktrees/199-jarvis-pdf-attachments`, branch
`199-jarvis-pdf-attachments`, cut from `origin/main` at `1eabc87`).

**Logic modules, built test-first** (red→green, one behavior per slice —
+10 attachment tests):

- **`normalize.ts`** — `validateAttachment` now accepts `application/pdf`
  up to `MAX_PDF_BYTES` (32 MB) and returns a `kind` discriminant
  (`"image" | "pdf"`); PDFs skip the `sharp` resize. 3 new tests (accept a
  PDF, reject >32 MB, accept at exactly 32 MB).
- **`content-blocks.ts`** — `buildClaudeMessages` gained a document-block
  branch: a `pdf` attachment becomes `{ type: "document", source: { type:
  "file", file_id } }`. The return type moved to
  `Anthropic.Beta.BetaMessageParam[]` (a `file` document source is a
  Files-API beta feature). A replayed PDF reuses its stored `file_id`; a
  reference with no `file_id` degrades to a text note. 4 new tests
  (document-block output, document+text ordering, file_id replay,
  missing-file_id degradation).
- **`storage.ts`** — `application/pdf` maps to a `.pdf` extension;
  `uploadAttachment` takes a broadened `AttachmentMediaType`. 1 new test.
- **`anthropic-files.ts`** (new) — `uploadPdfToAnthropic` uploads a PDF's
  bytes to the Anthropic Files API and returns its `file_id`;
  `ANTHROPIC_FILES_BETA` (`"files-api-2025-04-14"`) is shared by the
  attachments and chat routes. Thin integration wrapper — covered by the
  route test, no separate unit test (a wrapper test would only assert mock
  interactions).

**Integration:**

- **`POST /api/jarvis/attachments`** — accepts PDFs: stores the bytes
  (no resize), uploads to the Anthropic Files API, records the `file_id`
  on the reference. A failed Files API upload **rejects the whole
  attachment** (a PDF with no `file_id` can never reach Claude). 2 new
  route tests; the existing "rejects an unsupported type" test was
  retargeted off `application/pdf` (now valid) to a `.docx` media type.
- **`src/app/api/jarvis/chat/route.ts`** — switched the main Jarvis call
  and the tool-use loop from `anthropic.messages.create` to
  `anthropic.beta.messages.create` with `betas: [ANTHROPIC_FILES_BETA]`
  so PDF document blocks are accepted. The personality-pass call stays on
  the non-beta API (text-only, never touches attachments).
- **UI** — `JarvisInput` accepts PDFs (`accept="image/*,application/pdf"`)
  and shows a picked PDF as a labelled chip with upload/remove state;
  `JarvisMessage` renders a PDF attachment as a labelled chip that opens
  the stored PDF via a signed URL.
- **`src/lib/types.ts`** — `JarvisAttachment.kind` is now `"image" |
  "pdf"`; a new optional `file_id` carries the Anthropic Files API id.

**No migration** — PDFs reuse the existing `jarvis-attachments` bucket
(#198's migration, already on AAA prod). The Anthropic Files API is an
external service; nothing to apply.

Full suite **887 tests pass** (134 files); `tsc` clean apart from the
pre-existing, unrelated `sync-folder-incremental.test.ts` error; ESLint
**0 problems** on all changed files. One feature commit `feefa93` (13
files, +555/−95); **[PR #207](https://github.com/ericdaniels22/Nookleus/pull/207)**
opened against `main` with `Closes #199`, then **MERGED** (merge commit
`8fd4739`) — #199 auto-closed COMPLETED. The worktree + local branch were
removed.

## What's next

- **Browser-verify on AAA prod:** in Jarvis Core, attach a PDF, confirm
  Jarvis answers about it, ask a follow-up without re-attaching (file_id
  replay), reopen the conversation, open the PDF chip.
- **Parent PRD #153** — remaining slices still unbuilt: multiple files per
  message (#200, in progress in a parallel worktree
  `200-chat-attachments-multi-file`), department routing for attachments
  (#201, worktree `201-attachments-follow-routing` present), and prompt
  caching (replay still re-sends image bytes every turn — the PDF path
  already avoids re-encoding via `file_id`).

## Decisions locked

- **Failed Anthropic Files API upload rejects the attachment**
  (AskUserQuestion). The route returns 500; the user retries. A PDF with no
  `file_id` is unusable, so storing it half-way is never worth it. The
  bucket object from a failed attach is a minor orphan — accepted, the
  same tradeoff #198 documented for abandoned uploads.
- **Beta Messages API** — a document block with a `file` source is a
  Files-API beta feature, so the Jarvis chat route moved to
  `anthropic.beta.messages.create`. Forced by the `file_id` acceptance
  criterion; no non-beta path satisfies "reuse file_id rather than
  re-encode". `buildClaudeMessages` therefore returns beta message params.
- The issue cites **ADR 0002** for the JSONB-inline storage decision, but
  only `ADR 0001` exists in `docs/adr/` (same as #198 noted) — followed
  the acceptance criteria directly.

## Open threads

- **Not browser-verified** — the flow is covered by unit + route tests but
  has not been exercised against the live app / Anthropic Files API.
- **Anthropic-side files are not cleaned up on conversation delete** — the
  `DELETE /api/jarvis/conversations/[id]` route sweeps the bucket prefix
  but does not delete the Anthropic Files API files. They expire per
  Anthropic's retention. Out of scope for #199; a future slice could add
  it if cost matters.
- **`origin/199-jarvis-pdf-attachments` remote branch still exists** — the
  PR was merged with `--delete-branch=false` and the remote-branch delete
  was not authorized this session. Delete it from GitHub or with
  `git push origin --delete 199-jarvis-pdf-attachments` when convenient.

## Mechanical state

- **Branch:** `199-jarvis-pdf-attachments` (worktree, removed at session
  end), cut from `origin/main` at `1eabc87`.
- **Commit:** feature `feefa93` `feat: PDF support for Jarvis Chat
  attachments (#199)` (13 files, +555/−95); merged to `main` via PR #207,
  merge commit **`8fd4739`**. This vault handoff commit lands on top.
- **Uncommitted changes:** none beyond this handoff doc + the `00-NOW.md`
  update.
- **Migrations applied this session:** none — #199 needs no migration.
- **Deployed to Vercel:** yes — the #207 merge to `main` triggers the
  Vercel deploy. No Xcode build (nothing under `ios/` changed).
- **Worktree:** `.claude/worktrees/199-jarvis-pdf-attachments` removed;
  local branch deleted; `origin/199-jarvis-pdf-attachments` still on
  GitHub.

## Notes for next session

The `EnterWorktree` native tool fails in this repo with `EEXIST` on
`mkdir .claude/worktrees` (non-recursive mkdir; the directory already
exists). Workaround used this session: `git worktree add` manually, then
`EnterWorktree` with `path:` to switch into it. Captured in agent memory.

`buildClaudeMessages` now returns **beta** message params — any future
caller (e.g. the department routes in #201) must call
`anthropic.beta.messages.create` with `ANTHROPIC_FILES_BETA`, not the
non-beta API, or PDF document blocks will be rejected.

A PDF's `file_id` is stored inline on the attachment in the
`jarvis_conversations.messages` JSONB, so replay reuses it for free — no
prompt caching is needed for the "don't re-encode a PDF" guarantee
(caching is a separate #153 slice, deliberately out of #199's scope).

## Links

- Issue: [#199](https://github.com/ericdaniels22/Nookleus/issues/199) ·
  Parent: [#153](https://github.com/ericdaniels22/Nookleus/issues/153)
- PR: [#207](https://github.com/ericdaniels22/Nookleus/pull/207) (merged)
- Prior slice: [[2026-05-22-198-jarvis-chat-attachments]]
- Current state: [[00-NOW]]
