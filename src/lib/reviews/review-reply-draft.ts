// Draft a suggested public reply to one Google review via the AI drafter.
//
// The reviewer→Contact/Job match (when present) PRIVATELY informs the draft —
// it lets the reply be warmer and more specific — but the public reply must
// never assert the match, name the customer, or reveal job details (#608 AC2).
// Nothing here posts or persists: it only returns suggested text for a human to
// edit and approve (#608 AC1/AC3).

import Anthropic from "@anthropic-ai/sdk";
import type { ReviewerMatch } from "./reviewer-matcher";

// The drafter is the thin seam over the model call, injected so unit tests run
// without an API key or a network round-trip.
export type ReplyDrafter = (req: {
  system: string;
  prompt: string;
}) => Promise<string>;

export interface DraftReviewInput {
  star_rating: number;
  comment: string | null;
  reviewer_name: string | null;
}

export interface DraftReviewReplyDeps {
  drafter?: ReplyDrafter;
}

export async function draftReviewReply(
  review: DraftReviewInput,
  match: ReviewerMatch | null,
  deps: DraftReviewReplyDeps = {},
): Promise<string> {
  const drafter = deps.drafter ?? defaultDrafter;

  const lines = [
    `Star rating: ${review.star_rating} out of 5`,
    `Review text: ${review.comment ?? "(no written comment)"}`,
  ];

  if (match) {
    // PRIVATE drafting context — informs warmth and specificity, never to be
    // restated in the public reply (#608 AC2). The system prompt enforces that.
    lines.push("", "Private context (do NOT reveal or restate in the reply):");
    lines.push(`- Likely customer: ${match.contact_name}`);
    if (match.job) {
      lines.push(`- Job number: ${match.job.job_number}`);
      if (match.job.property_address) {
        lines.push(`- Property address: ${match.job.property_address}`);
      }
    }
  }

  const reply = await drafter({ system: SYSTEM_PROMPT, prompt: lines.join("\n") });

  // A blank reply (the model returned only thinking, or refused) is a failure,
  // not a suggestion. Surface it rather than hand back an empty draft (#608 AC5).
  if (!reply.trim()) {
    throw new Error("The AI returned an empty reply.");
  }

  // Deterministic privacy backstop (#608 AC2): the system prompt asks the model
  // not to assert the private match, but that is a soft guarantee. If the draft
  // nonetheless contains the genuinely-private job number or property address,
  // discard it rather than surface it for posting. The contact name is NOT
  // guarded — it equals the reviewer's already-public display name, so a warm
  // "Thank you, Jane!" is fine.
  if (match?.job) {
    const lowered = reply.toLowerCase();
    const privateFacts = [match.job.job_number, match.job.property_address].filter(
      (fact): fact is string => typeof fact === "string" && fact.trim().length > 0,
    );
    if (privateFacts.some((fact) => lowered.includes(fact.toLowerCase()))) {
      throw new Error("The draft asserted private context and was discarded.");
    }
  }

  return reply;
}

const SYSTEM_PROMPT = [
  "You draft a short, warm, professional public reply from the business owner",
  "to a Google review. The reply is published verbatim under the review, so",
  "write it as the owner would post it. Thank the reviewer, keep it to a",
  "sentence or two, and never sound like a form letter.",
  "",
  "You may be given PRIVATE context about who the reviewer probably is (a likely",
  "customer name, a job number, a property address). This is a heuristic guess,",
  "not a fact, and it is confidential. Use it only to make the tone warmer and",
  "more specific. NEVER reveal it in the reply: do not name the customer, do not",
  "state the job number or address, and do not assert or confirm that the",
  "reviewer is a known customer. If you are unsure, stay generic.",
  "",
  "Return only the reply text, with no preamble or quotation marks.",
].join("\n");

// The narrow slice of the Anthropic SDK the drafter needs — just enough to
// inject a fake in tests.
export interface AnthropicMessagesClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
}

// Wire the drafter to the Anthropic Messages API (claude-opus-4-8, adaptive
// thinking). Returns only the concatenated text blocks — thinking blocks are
// dropped — trimmed of surrounding whitespace.
export function createAnthropicDrafter(
  client: AnthropicMessagesClient,
): ReplyDrafter {
  return async ({ system, prompt }) => {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  };
}

const defaultDrafter: ReplyDrafter = (req) =>
  createAnthropicDrafter(
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  )(req);
