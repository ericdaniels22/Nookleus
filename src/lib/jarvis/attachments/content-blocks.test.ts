import { describe, it, expect } from "vitest";
import { buildClaudeMessages } from "./content-blocks";
import type { JarvisMessage } from "@/lib/types";

// Issue #198 — the chat route turns the JarvisMessage history into the
// Anthropic message-params array. Text stays text; an attached image
// becomes an image content block. A reference-to-source resolver is
// injected so this maps cleanly without touching storage.

function msg(partial: Partial<JarvisMessage> & { role: JarvisMessage["role"] }): JarvisMessage {
  return {
    content: "",
    timestamp: "2026-05-22T00:00:00.000Z",
    ...partial,
  };
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

  it("maps a user message with an image attachment to image + text blocks", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "What is this?",
        attachment: {
          kind: "image",
          storage_path: "org-1/conv-9/u.jpg",
          media_type: "image/jpeg",
        },
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
        attachment: {
          kind: "image",
          storage_path: "org-1/conv-9/u.png",
          media_type: "image/png",
        },
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

  it("replays every image found in the history window", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "first photo",
        attachment: {
          kind: "image",
          storage_path: "p1",
          media_type: "image/jpeg",
        },
      }),
      msg({ role: "assistant", content: "Got it." }),
      msg({
        role: "user",
        content: "second photo",
        attachment: {
          kind: "image",
          storage_path: "p2",
          media_type: "image/png",
        },
      }),
      msg({ role: "user", content: "compare them" }),
    ];

    const resolvedPaths: string[] = [];
    const result = await buildClaudeMessages(history, async (att) => {
      resolvedPaths.push(att.storage_path);
      return { base64: `data-${att.storage_path}`, mediaType: att.media_type };
    });

    expect(resolvedPaths).toEqual(["p1", "p2"]);

    const imageData: string[] = [];
    for (const message of result) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type === "image" && block.source.type === "base64") {
          imageData.push(block.source.data);
        }
      }
    }
    expect(imageData).toEqual(["data-p1", "data-p2"]);
  });

  it("falls back to a text note when an attachment cannot be resolved", async () => {
    const history: JarvisMessage[] = [
      msg({
        role: "user",
        content: "What's wrong here?",
        attachment: {
          kind: "image",
          storage_path: "org-1/conv-9/missing.jpg",
          media_type: "image/jpeg",
        },
      }),
    ];

    const result = await buildClaudeMessages(history, async () => {
      throw new Error("object not found");
    });

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    // No image block — the message degrades to plain text so Jarvis can
    // still answer (and explain the image is unavailable).
    expect(typeof result[0].content).toBe("string");
    expect(result[0].content).toMatch(/What's wrong here\?/);
    expect(result[0].content).toMatch(/image|attachment/i);
  });
});
