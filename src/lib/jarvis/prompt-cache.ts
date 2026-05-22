// Prompt caching for the Jarvis Claude calls (#203).
//
// Places a `cache_control: { type: "ephemeral" }` breakpoint on the last
// content block of the last message in the history. The Messages API
// renders `tools → system → messages` before hashing the cacheable prefix,
// so this single breakpoint caches the tool list, the system prompt, and
// every prior message — exactly the chunk replayed turn after turn in a
// long conversation. On a cache hit the replayed image and PDF blocks are
// served at ~10% of base input price; the response is byte-identical so
// caching is a pure cost win.

import type Anthropic from "@anthropic-ai/sdk";

const EPHEMERAL: Anthropic.Beta.BetaCacheControlEphemeral = { type: "ephemeral" };

export function withPromptCache(
  messages: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaMessageParam[] {
  if (messages.length === 0) return messages;

  const lastIndex = messages.length - 1;
  return messages.map((message, index) => {
    if (index !== lastIndex) return message;
    const content = message.content;
    if (typeof content === "string") {
      return {
        ...message,
        content: [{ type: "text", text: content, cache_control: EPHEMERAL }],
      };
    }
    if (content.length === 0) return message;
    const lastBlockIndex = content.length - 1;
    return {
      ...message,
      content: content.map((block, i) =>
        i === lastBlockIndex ? { ...block, cache_control: EPHEMERAL } : block,
      ),
    };
  });
}
