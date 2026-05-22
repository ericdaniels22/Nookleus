import { describe, it, expect } from "vitest";
import { buildClaudeMessages } from "./content-blocks";
import type { JarvisAttachment, JarvisMessage } from "@/lib/types";

// Issue #198 / #200 — the chat route turns the JarvisMessage history into
// the Anthropic message-params array. Text stays text; each attached image
// becomes an image content block. A message may carry several attachments
// (#200), so every one is mapped, in order. A reference-to-source resolver
// is injected so this maps cleanly without touching storage.

function msg(
  partial: Partial<JarvisMessage> & { role: JarvisMessage["role"] },
): JarvisMessage {
  return {
    content: "",
    timestamp: "2026-05-22T00:00:00.000Z",
    ...partial,
  };
}

function image(storagePath: string, mediaType: string): JarvisAttachment {
  return { kind: "image", storage_path: storagePath, media_type: mediaType };
}

describe("buildClaudeMessages", () => {
  it("maps a text-only user message to a plain message", async () => {
    const history: JarvisMessage[] = [
      msg({ role: "user", content: "How many active jobs?" }),
    ];

    const result = await buildClaudeMessages(history, async () => {
      throw new Error("resolver should not be called");
    });

    expect(result).toEqual([
      { role: "user", content: "How many active jobs?" },
    ]);
  });

  it("maps a user message with one image attachment to image + text blocks", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "What is this?",
        attachments: [image("org-1/conv-9/u.jpg", "image/jpeg")],
      }),
    ];

    const result = await buildClaudeMessages(history, async (att) => ({
      base64: "BASE64DATA",
      mediaType: att.media_type,
    }));

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "BASE64DATA",
            },
          },
          { type: "text", text: "What is this?" },
        ],
      },
    ]);
  });

  it("omits the text block when an attachment message has no text", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "",
        attachments: [image("org-1/conv-9/u.png", "image/png")],
      }),
    ];

    const result = await buildClaudeMessages(history, async (att) => ({
      base64: "PNGDATA",
      mediaType: att.media_type,
    }));

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "PNGDATA",
            },
          },
        ],
      },
    ]);
  });

  it("maps every attachment on a multi-file message to image blocks, in order", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "what do you make of these?",
        attachments: [
          image("org-1/conv-9/a.jpg", "image/jpeg"),
          image("org-1/conv-9/b.png", "image/png"),
          image("org-1/conv-9/c.webp", "image/webp"),
        ],
      }),
    ];

    const result = await buildClaudeMessages(history, async (att) => ({
      base64: `data-${att.storage_path}`,
      mediaType: att.media_type,
    }));

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "data-org-1/conv-9/a.jpg",
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "data-org-1/conv-9/b.png",
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/webp",
              data: "data-org-1/conv-9/c.webp",
            },
          },
          { type: "text", text: "what do you make of these?" },
        ],
      },
    ]);
  });

  it("replays every image found in the history window", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "first photos",
        attachments: [
          image("p1", "image/jpeg"),
          image("p2", "image/png"),
        ],
      }),
      msg({ role: "assistant", content: "Got it." }),
      msg({
        role: "user",
        content: "third photo",
        attachments: [image("p3", "image/png")],
      }),
      msg({ role: "user", content: "compare them" }),
    ];

    const resolvedPaths: string[] = [];
    const result = await buildClaudeMessages(history, async (att) => {
      resolvedPaths.push(att.storage_path);
      return { base64: `data-${att.storage_path}`, mediaType: att.media_type };
    });

    // Every image in the window is resolved (messages resolve concurrently,
    // so the call order isn't pinned — the block order below is what matters).
    expect([...resolvedPaths].sort()).toEqual(["p1", "p2", "p3"]);

    const imageData: string[] = [];
    for (const message of result) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type === "image" && block.source.type === "base64") {
          imageData.push(block.source.data);
        }
      }
    }
    expect(imageData).toEqual(["data-p1", "data-p2", "data-p3"]);
  });

  it("keeps the readable images when one attachment in the message fails", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "look at these",
        attachments: [
          image("ok-1", "image/jpeg"),
          image("broken", "image/png"),
          image("ok-2", "image/webp"),
        ],
      }),
    ];

    const result = await buildClaudeMessages(history, async (att) => {
      if (att.storage_path === "broken") {
        throw new Error("object not found");
      }
      return { base64: `data-${att.storage_path}`, mediaType: att.media_type };
    });

    expect(result).toHaveLength(1);
    const content = result[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;

    // The two readable images still reach Claude.
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(2);

    // The caption survives, and the failed image degrades to a note so
    // Jarvis can still answer and explain the attachment is unavailable.
    const text = content.find((b) => b.type === "text");
    expect(text?.type === "text" && text.text).toMatch(/look at these/);
    expect(text?.type === "text" && text.text).toMatch(/image|attachment/i);
  });

  it("degrades to a note-only message when the lone attachment fails and there is no text", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "",
        attachments: [image("org-1/conv-9/missing.jpg", "image/jpeg")],
      }),
    ];

    const result = await buildClaudeMessages(history, async () => {
      throw new Error("object not found");
    });

    expect(result).toHaveLength(1);
    const content = result[0].content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;

    expect(content.filter((b) => b.type === "image")).toHaveLength(0);
    const text = content.find((b) => b.type === "text");
    expect(text?.type === "text" && text.text).toMatch(/image|attachment/i);
  });
});
