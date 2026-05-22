import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { withPromptCache } from "./prompt-cache";

// Issue #203 — every Jarvis Claude call places a cache_control breakpoint on
// the replayed message history so a long conversation that re-sends many
// images and a PDF document block each turn hits the cache on follow-up
// turns instead of paying full input cost. The breakpoint goes on the last
// content block of the last message — the rendered prefix
// (tools → system → messages) before that block is the cacheable region.

describe("withPromptCache", () => {
  it("returns an empty array unchanged when the history is empty", () => {
    const result = withPromptCache([]);
    expect(result).toEqual([]);
  });

  it("converts a string-content last message to a text block carrying cache_control", () => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: "How many active jobs?" },
    ];

    const result = withPromptCache(messages);

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "How many active jobs?",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ]);
  });

  it("leaves earlier messages untouched", () => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: "First turn" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second turn" },
    ];

    const result = withPromptCache(messages);

    expect(result[0]).toEqual({ role: "user", content: "First turn" });
    expect(result[1]).toEqual({ role: "assistant", content: "First answer" });
    // Only the final message picks up the breakpoint.
    expect(result[2]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Second turn",
          cache_control: { type: "ephemeral" },
        },
      ],
    });
  });

  it("does not mutate the input messages or content blocks", () => {
    const lastBlock: Anthropic.Beta.BetaTextBlockParam = {
      type: "text",
      text: "hi",
    };
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: [lastBlock] },
    ];

    withPromptCache(messages);

    // Caller can re-use the same array and block on the next turn (e.g.
    // the tool-use loop pushes onto `claudeMessages` between requests).
    expect(messages[0].content).toEqual([{ type: "text", text: "hi" }]);
    expect(lastBlock).toEqual({ type: "text", text: "hi" });
  });

  it("places cache_control on the last content block of the last message", () => {
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "DATA",
            },
          },
          { type: "text", text: "What is this?" },
        ],
      },
    ];

    const result = withPromptCache(messages);

    expect(result).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "DATA",
            },
          },
          {
            type: "text",
            text: "What is this?",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ]);
  });
});
