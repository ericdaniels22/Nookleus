import { describe, expect, it } from "vitest";

import {
  categorizeEmail,
  INSURANCE_CARRIER_DOMAINS,
  type CategoryRule,
} from "./email-categorizer";

const noRules: CategoryRule[] = [];

describe("categorizeEmail — Jobs bucket claim signals", () => {
  it("files mail whose subject carries a claim number into Jobs, with no rules", () => {
    const verdict = categorizeEmail(
      {
        from_address: "someone@unknown-sender.com",
        subject: "First notice of loss — Claim #ABC-1234567",
        body_text: "We have opened a claim for the reported water damage.",
      },
      noRules,
    );

    expect(verdict).toBe("jobs");
  });

  it("files mail from a known insurance-carrier domain into Jobs", () => {
    const verdict = categorizeEmail(
      {
        from_address: "claims@statefarm.com",
        subject: "Your policy documents",
        body_text: "Please find attached.",
      },
      noRules,
      { carrierDomains: ["statefarm.com"], adjusterAddresses: [] },
    );

    expect(verdict).toBe("jobs");
  });

  it("files mail from a known adjuster address into Jobs (case-insensitive)", () => {
    const verdict = categorizeEmail(
      {
        from_address: "Jane.Adjuster@Gmail.com",
        subject: "Re: your inspection",
        body_text: "Following up.",
      },
      noRules,
      { carrierDomains: [], adjusterAddresses: ["jane.adjuster@gmail.com"] },
    );

    expect(verdict).toBe("jobs");
  });

  it("lets an explicit rule win over a claim signal (rules beat heuristics)", () => {
    const rules: CategoryRule[] = [
      { match_type: "sender_domain", match_value: "statefarm.com", category: "promotions" },
    ];

    const verdict = categorizeEmail(
      {
        from_address: "offers@statefarm.com",
        subject: "Save on your policy — Claim #ABC-1234567 mentioned",
        body_text: "Marketing blast.",
      },
      rules,
      { carrierDomains: ["statefarm.com"], adjusterAddresses: [] },
    );

    expect(verdict).toBe("promotions");
  });

  it("falls back to General for unrecognized mail with no rule or claim signal", () => {
    const verdict = categorizeEmail(
      {
        from_address: "friend@example.com",
        subject: "Lunch tomorrow?",
        body_text: "Are we still on for noon?",
      },
      noRules,
      { carrierDomains: ["statefarm.com"], adjusterAddresses: ["jane.adjuster@gmail.com"] },
    );

    expect(verdict).toBe("general");
  });

  it("does not treat prose like 'claims processing' as a claim number", () => {
    const verdict = categorizeEmail(
      {
        from_address: "news@example.com",
        subject: "How our claims processing keeps improving",
        body_text: "No numbers here, just a newsletter.",
      },
      noRules,
    );

    expect(verdict).toBe("general");
  });

  it("files carrier mail into Jobs using the curated seed domains (incl. subdomains)", () => {
    const verdict = categorizeEmail(
      {
        from_address: "no-reply@claims.statefarm.com",
        subject: "Update on your file",
        body_text: "Details inside.",
      },
      noRules,
      { carrierDomains: [...INSURANCE_CARRIER_DOMAINS], adjusterAddresses: [] },
    );

    expect(verdict).toBe("jobs");
  });
});
