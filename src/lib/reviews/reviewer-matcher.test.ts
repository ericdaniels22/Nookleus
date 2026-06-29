import { describe, it, expect } from "vitest";
import {
  matchReviewerToContext,
  type ReviewerMatcherCache,
} from "./reviewer-matcher";

function cache(over: Partial<ReviewerMatcherCache> = {}): ReviewerMatcherCache {
  return { contacts: [], jobs: [], ...over };
}

// matchReviewerToContext — heuristically link a Google reviewer (we only know
// their display name) to a Contact, and that Contact's Job, to PRIVATELY inform
// an AI-drafted reply. The match is never asserted in the public reply (#608
// AC2); this function only surfaces the context, it does not draft.
describe("matchReviewerToContext", () => {
  it("matches a reviewer to a contact by full name, case-insensitively", () => {
    const result = matchReviewerToContext(
      cache({ contacts: [{ id: "c-1", full_name: "Jane Doe" }] }),
      "jane doe",
    );
    expect(result?.contact_id).toBe("c-1");
    expect(result?.contact_name).toBe("Jane Doe");
  });

  it("returns null for an anonymous reviewer, even past a blank-named contact", () => {
    const result = matchReviewerToContext(
      cache({ contacts: [{ id: "c-blank", full_name: "   " }] }),
      null,
    );
    expect(result).toBeNull();
  });

  it("includes the matched contact's job as private context", () => {
    const result = matchReviewerToContext(
      cache({
        contacts: [{ id: "c-1", full_name: "Jane Doe" }],
        jobs: [
          {
            id: "j-1",
            job_number: "WTR-2026-0001",
            property_address: "12 Oak St",
            contact_id: "c-1",
          },
        ],
      }),
      "Jane Doe",
    );
    expect(result?.job?.id).toBe("j-1");
    expect(result?.job?.job_number).toBe("WTR-2026-0001");
    expect(result?.job?.property_address).toBe("12 Oak St");
  });

  it("does not match on a partial name (exact match only — no identity leak)", () => {
    const result = matchReviewerToContext(
      cache({ contacts: [{ id: "c-1", full_name: "Jane Doe" }] }),
      "Jane",
    );
    expect(result).toBeNull();
  });
});
