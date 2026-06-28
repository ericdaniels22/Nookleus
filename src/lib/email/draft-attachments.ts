// Pure reconcile/restore logic for draft attachments (issue #663, PRD #634).
//
// A draft's attachment set is reconciled against the email_attachments rows
// already persisted for it on every autosave: newly-attached files are
// inserted, removed files are deleted, and files that survived the edit are
// left untouched so repeated autosaves never accumulate duplicate rows.
// `storage_path` is the natural identity — the upload route mints a unique
// `drafts/${timestamp}-${name}` per file, so a "changed" file is always a new
// path, never a mutated row.

// A freshly-uploaded attachment as it arrives in the drafts save payload.
export interface DraftAttachmentInput {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

// The slice of an email_attachments row reconciliation needs: its id (to
// delete) and its storage_path (to match against the current set).
export interface PersistedAttachmentRow {
  id: string;
  storage_path: string;
}

export interface AttachmentReconciliation {
  toInsert: DraftAttachmentInput[];
  toDeleteIds: string[];
}

export function reconcileDraftAttachments(
  previous: PersistedAttachmentRow[],
  current: DraftAttachmentInput[],
): AttachmentReconciliation {
  const previousPaths = new Set(previous.map((r) => r.storage_path));
  const currentPaths = new Set(current.map((a) => a.storage_path));

  return {
    toInsert: current.filter((a) => !previousPaths.has(a.storage_path)),
    toDeleteIds: previous
      .filter((r) => !currentPaths.has(r.storage_path))
      .map((r) => r.id),
  };
}

// An email_attachments row as joined onto a resumed draft (the `EmailAttachment`
// shape: db-only columns plus nullable content_type/file_size/storage_path).
export interface JoinedAttachmentRow {
  filename: string;
  content_type?: string | null;
  file_size?: number | null;
  storage_path?: string | null;
}

// Project the persisted rows back to the UploadedFile shape the compose modal
// threads through `defaultAttachments` — so a resumed draft re-hydrates its
// chips and re-sends the files. Drops the db-only columns the modal ignores,
// skips rows with no storage_path (nothing to download or re-send), and fills
// safe defaults so every restored row satisfies the non-null UploadedFile shape.
export function restoreDraftAttachments(
  rows: JoinedAttachmentRow[] | null | undefined,
): DraftAttachmentInput[] {
  return (rows ?? [])
    .filter((r) => !!r.storage_path)
    .map((r) => ({
      filename: r.filename,
      content_type: r.content_type || "application/octet-stream",
      file_size: r.file_size ?? 0,
      storage_path: r.storage_path!,
    }));
}
