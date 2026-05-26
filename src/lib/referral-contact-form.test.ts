// Pure-logic tests for the "+ Add contact" form on the Call Worksheet
// (PRD #249, issue #255). Mirrors `referral-partner-form.test.ts` from
// issue #250 — validity guard + insert-payload builder, both I/O-free.

import { describe, expect, it } from "vitest";

import {
  buildNewReferralContactPayload,
  isValidNewReferralContact,
  type NewReferralContactInput,
} from "./referral-contact-form";

const ORG = "org-1";
const PARTNER = "p-1";

function input(
  overrides: Partial<NewReferralContactInput> = {},
): NewReferralContactInput {
  return {
    full_name: "Pat Smith",
    phone: "",
    email: "",
    notes: "",
    ...overrides,
  };
}

describe("isValidNewReferralContact", () => {
  it("rejects an empty full_name — the only required field", () => {
    expect(isValidNewReferralContact(input({ full_name: "" }))).toBe(false);
    expect(isValidNewReferralContact(input({ full_name: "   " }))).toBe(false);
  });

  it("accepts any input with a non-blank full_name — every other field is optional", () => {
    expect(isValidNewReferralContact(input())).toBe(true);
    expect(
      isValidNewReferralContact(input({ full_name: "X", phone: "" })),
    ).toBe(true);
  });
});

describe("buildNewReferralContactPayload", () => {
  it("pins role='referral_contact' and links the Referral Partner", () => {
    const payload = buildNewReferralContactPayload(input(), ORG, PARTNER);
    expect(payload.role).toBe("referral_contact");
    expect(payload.referral_partner_id).toBe(PARTNER);
    expect(payload.organization_id).toBe(ORG);
    expect(payload.full_name).toBe("Pat Smith");
  });

  it("trims full_name so leading and trailing whitespace doesn't survive into storage", () => {
    const payload = buildNewReferralContactPayload(
      input({ full_name: "  Pat Smith  " }),
      ORG,
      PARTNER,
    );
    expect(payload.full_name).toBe("Pat Smith");
  });

  it("collapses every blank optional field to null — empty strings never reach the column", () => {
    const payload = buildNewReferralContactPayload(input(), ORG, PARTNER);
    expect(payload.phone).toBeNull();
    expect(payload.email).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("trims optional fields and keeps the non-blank ones", () => {
    const payload = buildNewReferralContactPayload(
      input({
        phone: " 555-123-4567 ",
        email: "pat@acme.test",
        notes: "  loves email  ",
      }),
      ORG,
      PARTNER,
    );
    expect(payload.phone).toBe("555-123-4567");
    expect(payload.email).toBe("pat@acme.test");
    expect(payload.notes).toBe("loves email");
  });
});
