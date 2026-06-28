import { describe, it, expect } from "vitest";
import type { EmailAttachment } from "@/lib/types";
import {
  reconcileDraftAttachments,
  restoreDraftAttachments,
} from "./draft-attachments";

// A freshly-uploaded attachment as it arrives in the /api/email/drafts payload.
function upload(storage_path: string, filename = storage_path) {
  return { filename, content_type: "application/pdf", file_size: 100, storage_path };
}

// An email_attachments row already persisted for this draft.
function row(id: string, storage_path: string) {
  return { id, storage_path };
}

// A full email_attachments row as it arrives joined onto a resumed draft — the
// real EmailAttachment shape (db-only columns included) that the email-inbox
// call site passes restore. Override only the fields a given case cares about.
function joined(overrides: Partial<EmailAttachment>): EmailAttachment {
  return {
    id: "att-1",
    email_id: "draft-1",
    organization_id: "org-1",
    created_at: "2026-06-27T00:00:00Z",
    filename: "file.pdf",
    content_type: "application/pdf",
    file_size: 100,
    storage_path: "drafts/1-file.pdf",
    ...overrides,
  };
}

describe("reconcileDraftAttachments", () => {
  it("inserts the file on the first save of a brand-new draft", () => {
    const result = reconcileDraftAttachments([], [upload("drafts/1-a.pdf")]);

    expect(result.toInsert).toEqual([upload("drafts/1-a.pdf")]);
    expect(result.toDeleteIds).toEqual([]);
  });

  it("re-saving an unchanged draft inserts nothing (no duplicate rows accumulate)", () => {
    const result = reconcileDraftAttachments(
      [row("att-1", "drafts/1-a.pdf")],
      [upload("drafts/1-a.pdf")],
    );

    expect(result.toInsert).toEqual([]);
    expect(result.toDeleteIds).toEqual([]);
  });

  it("deletes the row for a file removed before save (not resurrected on resume)", () => {
    const result = reconcileDraftAttachments(
      [row("att-1", "drafts/1-a.pdf"), row("att-2", "drafts/2-b.pdf")],
      [upload("drafts/1-a.pdf")],
    );

    expect(result.toInsert).toEqual([]);
    expect(result.toDeleteIds).toEqual(["att-2"]);
  });

  it("swapping one file for another inserts the new and deletes the old", () => {
    const result = reconcileDraftAttachments(
      [row("att-1", "drafts/1-a.pdf")],
      [upload("drafts/2-b.pdf")],
    );

    expect(result.toInsert).toEqual([upload("drafts/2-b.pdf")]);
    expect(result.toDeleteIds).toEqual(["att-1"]);
  });

  it("clearing every attachment deletes all rows and inserts nothing", () => {
    const result = reconcileDraftAttachments(
      [row("att-1", "drafts/1-a.pdf"), row("att-2", "drafts/2-b.pdf")],
      [],
    );

    expect(result.toInsert).toEqual([]);
    expect(result.toDeleteIds).toEqual(["att-1", "att-2"]);
  });
});

describe("restoreDraftAttachments", () => {
  it("projects persisted rows to the compose UploadedFile shape, dropping db-only fields", () => {
    const restored = restoreDraftAttachments([
      joined({
        filename: "quote.pdf",
        content_type: "application/pdf",
        file_size: 2048,
        storage_path: "drafts/1-quote.pdf",
      }),
    ]);

    expect(restored).toEqual([
      {
        filename: "quote.pdf",
        content_type: "application/pdf",
        file_size: 2048,
        storage_path: "drafts/1-quote.pdf",
      },
    ]);
  });

  it("returns an empty list for a draft with no attachments", () => {
    expect(restoreDraftAttachments(undefined)).toEqual([]);
    expect(restoreDraftAttachments([])).toEqual([]);
  });

  it("drops rows with no storage_path — they can't be re-downloaded or re-sent", () => {
    const restored = restoreDraftAttachments([
      joined({ filename: "ghost.pdf", storage_path: null }),
    ]);

    expect(restored).toEqual([]);
  });

  it("defaults null content_type/file_size so the row satisfies the compose UploadedFile shape", () => {
    const restored = restoreDraftAttachments([
      joined({ filename: "scan", content_type: null, file_size: null, storage_path: "drafts/1-scan" }),
    ]);

    expect(restored).toEqual([
      {
        filename: "scan",
        content_type: "application/octet-stream",
        file_size: 0,
        storage_path: "drafts/1-scan",
      },
    ]);
  });
});
