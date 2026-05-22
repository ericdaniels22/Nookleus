import { describe, it, expect } from "vitest";
import {
  jarvisAttachmentPath,
  jarvisAttachmentConversationPrefix,
  extensionForMediaType,
  deleteConversationAttachments,
  type StorageClient,
} from "./storage";

// A storage client fake: `list` returns whatever objects are seeded under a
// prefix, `remove` records the paths it was asked to delete. `upload` and
// `download` are stubbed so the fake satisfies the full StorageClient shape;
// the delete tests never exercise them.
function fakeStorage(objectsByPrefix: Record<string, string[]>) {
  const removeCalls: string[][] = [];
  const listCalls: string[] = [];
  const client: StorageClient = {
    storage: {
      from() {
        return {
          async list(prefix: string) {
            listCalls.push(prefix);
            return {
              data: (objectsByPrefix[prefix] ?? []).map((name) => ({ name })),
              error: null,
            };
          },
          async remove(paths: string[]) {
            removeCalls.push(paths);
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
          async upload() {
            return { data: null, error: null };
          },
          async download() {
            return { data: null, error: null };
          },
        };
      },
    },
  };
  return { client, removeCalls, listCalls };
}

// Issue #198 — attachment objects live under a per-conversation prefix so
// that deleting a conversation can wipe its attachments with one prefix
// delete. The path shape is {organization_id}/{conversation_id}/{uuid}.{ext}.

describe("jarvisAttachmentPath", () => {
  it("builds an org- and conversation-scoped object path", () => {
    const path = jarvisAttachmentPath("org-1", "conv-9", "uuid-abc", "jpg");
    expect(path).toBe("org-1/conv-9/uuid-abc.jpg");
  });

  it("starts the object path with the conversation prefix", () => {
    const prefix = jarvisAttachmentConversationPrefix("org-1", "conv-9");
    const path = jarvisAttachmentPath("org-1", "conv-9", "uuid-abc", "jpg");
    expect(path.startsWith(prefix + "/")).toBe(true);
    expect(prefix).toBe("org-1/conv-9");
  });
});

describe("extensionForMediaType", () => {
  it("maps each supported image type to a file extension", () => {
    expect(extensionForMediaType("image/jpeg")).toBe("jpg");
    expect(extensionForMediaType("image/png")).toBe("png");
    expect(extensionForMediaType("image/gif")).toBe("gif");
    expect(extensionForMediaType("image/webp")).toBe("webp");
  });
});

describe("deleteConversationAttachments", () => {
  it("removes every object under the conversation prefix", async () => {
    const prefix = jarvisAttachmentConversationPrefix("org-1", "conv-9");
    const { client, removeCalls } = fakeStorage({
      [prefix]: ["a.jpg", "b.png"],
    });

    await deleteConversationAttachments(client, "org-1", "conv-9");

    expect(removeCalls).toEqual([
      ["org-1/conv-9/a.jpg", "org-1/conv-9/b.png"],
    ]);
  });

  it("does not call remove when the conversation has no attachments", async () => {
    const { client, removeCalls } = fakeStorage({});

    await deleteConversationAttachments(client, "org-1", "conv-empty");

    expect(removeCalls).toEqual([]);
  });
});
