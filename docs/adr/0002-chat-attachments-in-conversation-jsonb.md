# ADR 0002 — Chat attachments live in the conversation JSONB, not a table

Status: accepted, 2026-05-22

## Context

Jarvis is gaining the ability to accept **Chat attachments** — images and
PDFs a User adds to a message when talking with Jarvis (see `CONTEXT.md`).
The attachment bytes go in a new private `jarvis-attachments` bucket; the
open question is where the *references* to them are recorded.

Every other file feature in Nookleus carries its references in a
dedicated table:

- `job_files` — documents attached to a job
- `knowledge_documents` / `knowledge_chunks` — the RAG store
- `email_attachments` — attachments on synced mail

A reader who knows that pattern would reasonably expect a
`jarvis_attachments` table to appear alongside them.

## Decision

There is **no `jarvis_attachments` table**. A Chat attachment's
reference — storage path, media type, filename, size — is stored inline
as an optional `attachments` array on each message object inside the
existing `jarvis_conversations.messages` JSONB column.

The only schema migration the feature needs is creating the
`jarvis-attachments` bucket and its org-scoped storage policies. The
message shape itself changes with no migration, because `messages` is
already schemaless JSONB.

## Why

- **A Jarvis conversation is already one JSONB blob.** The entire
  message list lives in a single `messages` column. Attaching a sibling
  field to each message object respects that grain; a separate table
  fights it.
- **A Chat attachment has no lifecycle independent of its message.** It
  is created with the message, deleted with the conversation, and never
  queried on its own. A table earns its keep only when rows need to be
  found independently of their parent — nothing in the feature asks for
  "every image this Organization uploaded."
- **Scoping is already solved.** The `tenant_isolation_jarvis_conversations`
  RLS policy scopes the conversation row, so attachment references
  inherit Organization-scoping for free.
- **Cleanup is a prefix delete.** Bucket paths are keyed
  `{org_id}/{conversation_id}/{uuid}.{ext}`, so deleting a conversation
  means deleting one path prefix — no `ON DELETE CASCADE` needed.

### Alternative considered

**A `jarvis_attachments` table** with a foreign key to the conversation,
its own RLS policy, and `ON DELETE CASCADE`. Rejected: it adds a
migration and a second RLS policy to maintain, and buys nothing the
feature uses. Its only real advantage — querying attachments
independently of their conversation — is not a requirement.

## Consequences

- A future engineer must not "fix" this by introducing a
  `jarvis_attachments` table. The deviation from the table-per-file
  pattern is deliberate; this ADR is the record of why.
- Orphan-file cleanup runs by path prefix when a conversation is
  deleted, not by FK cascade. Any conversation-delete path has to also
  delete the bucket prefix.
- If Chat attachments ever need cross-conversation querying, that is the
  trigger to revisit this decision — and, with no real customers on prod
  yet (`project_no_real_customers_yet`), a later migration into a table
  stays cheap for now.
