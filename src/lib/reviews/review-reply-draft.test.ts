import { describe, it, expect } from "vitest";
import {
  draftReviewReply,
  createAnthropicDrafter,
  type ReplyDrafter,
} from "./review-reply-draft";

// A fake drafter stands in for the Anthropic call: it records the request it was
// handed and returns a canned reply, so these unit tests exercise the prompt
// assembly and the privacy guard without an API key or a network call.
function fakeDrafter(reply = "Thank you for the review!"): {
  drafter: ReplyDrafter;
  calls: { system: string; prompt: string }[];
} {
  const calls: { system: string; prompt: string }[] = [];
  const drafter: ReplyDrafter = async (req) => {
    calls.push(req);
    return reply;
  };
  return { drafter, calls };
}

// draftReviewReply — draft a suggested public reply to one Google review via the
// AI drafter. The reviewer→Contact/Job match (when present) PRIVATELY informs
// tone and specificity but is never asserted in the public reply (#608 AC2).
describe("draftReviewReply", () => {
  it("returns the drafter's text and puts the review rating + comment in the prompt", async () => {
    const { drafter, calls } = fakeDrafter("Thanks so much for the kind words!");

    const reply = await draftReviewReply(
      { star_rating: 5, comment: "Great service, fast and tidy.", reviewer_name: null },
      null,
      { drafter },
    );

    expect(reply).toBe("Thanks so much for the kind words!");
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("5");
    expect(calls[0].prompt).toContain("Great service, fast and tidy.");
  });

  it("feeds the matched contact and job into the prompt as private context", async () => {
    const { drafter, calls } = fakeDrafter();

    await draftReviewReply(
      { star_rating: 5, comment: "Loved the work", reviewer_name: "Jane Doe" },
      {
        contact_id: "c-1",
        contact_name: "Jane Doe",
        job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
      },
      { drafter },
    );

    // The match is drafting context: it informs tone/specificity, so the model
    // must actually see it.
    expect(calls[0].prompt).toContain("Jane Doe");
    expect(calls[0].prompt).toContain("WTR-2026-0001");
    expect(calls[0].prompt).toContain("12 Oak St");
  });

  it("treats a blank draft as a failure rather than returning it", async () => {
    // A model that returns only thinking, or a refusal, leaves an empty string.
    // Returning it would open a blank editor the admin might post unread; surface
    // it as a failure instead (#608 AC5).
    const { drafter } = fakeDrafter("   ");

    await expect(
      draftReviewReply(
        { star_rating: 5, comment: "Great", reviewer_name: null },
        null,
        { drafter },
      ),
    ).rejects.toThrow();
  });

  it("instructs the model never to assert the private match in the public reply", async () => {
    const { drafter, calls } = fakeDrafter();

    await draftReviewReply(
      { star_rating: 5, comment: "Great", reviewer_name: "Jane Doe" },
      {
        contact_id: "c-1",
        contact_name: "Jane Doe",
        job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
      },
      { drafter },
    );

    // AC2 lives in the system prompt: the match is private, so the reply must
    // not name the customer, the job, or the address, nor claim the reviewer is
    // a known customer.
    const system = calls[0].system.toLowerCase();
    expect(system).toContain("never");
    expect(system).toMatch(/do not (name|state|reveal|assert|confirm)/);
  });

  it("rejects a draft that leaks the private job number or address, as a hard backstop", async () => {
    // The system prompt asks the model not to assert the match, but that is a
    // soft guarantee. This is the deterministic backstop: if the returned draft
    // contains the private job number or property address, it is discarded
    // rather than surfaced for posting (#608 AC2).
    const leaky = fakeDrafter(
      "Thanks! Great working on job WTR-2026-0001 at your place.",
    );
    await expect(
      draftReviewReply(
        { star_rating: 5, comment: "Great", reviewer_name: "Jane Doe" },
        {
          contact_id: "c-1",
          contact_name: "Jane Doe",
          job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
        },
        { drafter: leaky.drafter },
      ),
    ).rejects.toThrow();

    const leakyAddress = fakeDrafter("Thanks for trusting us with 12 Oak St!");
    await expect(
      draftReviewReply(
        { star_rating: 5, comment: "Great", reviewer_name: "Jane Doe" },
        {
          contact_id: "c-1",
          contact_name: "Jane Doe",
          job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
        },
        { drafter: leakyAddress.drafter },
      ),
    ).rejects.toThrow();
  });

  it("allows a clean reply that uses the reviewer's already-public name", async () => {
    // The reviewer's display name is already public on the review, so a warm
    // "Thank you, Jane!" is fine — the backstop only guards the truly private
    // job number and address.
    const { drafter } = fakeDrafter("Thank you so much, Jane — it was a pleasure!");
    const reply = await draftReviewReply(
      { star_rating: 5, comment: "Great", reviewer_name: "Jane Doe" },
      {
        contact_id: "c-1",
        contact_name: "Jane Doe",
        job: { id: "j-1", job_number: "WTR-2026-0001", property_address: "12 Oak St" },
      },
      { drafter },
    );
    expect(reply).toContain("Jane");
  });
});

// createAnthropicDrafter — the production drafter, wired to the Anthropic SDK.
// Injecting a fake client lets us assert the request shape (model, system, the
// prompt as the user turn) and the text extraction without an API key.
describe("createAnthropicDrafter", () => {
  it("calls claude-opus-4-8 with the system + prompt and returns the joined text blocks", async () => {
    const captured: { model: string; system: string; messages: unknown }[] = [];
    const fakeClient = {
      messages: {
        create: async (body: { model: string; system: string; messages: unknown }) => {
          captured.push(body);
          return {
            content: [
              { type: "thinking", thinking: "deliberating" },
              { type: "text", text: "Thank you" },
              { type: "text", text: " so much!" },
            ],
          };
        },
      },
    };

    const drafter = createAnthropicDrafter(fakeClient as never);
    const out = await drafter({ system: "SYSTEM", prompt: "PROMPT BODY" });

    expect(out).toBe("Thank you so much!");
    expect(captured).toHaveLength(1);
    expect(captured[0].model).toBe("claude-opus-4-8");
    expect(captured[0].system).toBe("SYSTEM");
    // The prompt rides on the user turn.
    expect(JSON.stringify(captured[0].messages)).toContain("PROMPT BODY");
  });
});
