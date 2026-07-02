import { describe, it, expect } from "vitest";

import type { FormField } from "./types";
import { planFieldRows } from "./intake-form-layout";

// ─── Related-field pairing (#915, design-system §7.2) ────────────────────────
// At iPad width related fields sit two-up; unrelated fields stay single
// column. "Related" is decided purely from the config the org has: adjacent
// compact fields (values that are intrinsically short — phone, email, number,
// date, select) pair; free-text and rich widgets keep the full row.

function field(overrides: Partial<FormField> & Pick<FormField, "id" | "type">): FormField {
  return { label: overrides.id, ...overrides };
}

describe("planFieldRows — adjacent compact fields pair (#915)", () => {
  it("puts an adjacent phone + email pair on one two-column row", () => {
    const phone = field({ id: "f-phone", type: "phone" });
    const email = field({ id: "f-email", type: "email" });

    expect(planFieldRows([phone, email])).toEqual([[phone, email]]);
  });
});

describe("planFieldRows — an odd run of compact fields leaves the last one alone (#915)", () => {
  it("pairs sqft + stories and gives the trailing date its own row", () => {
    const sqft = field({ id: "f-sqft", type: "number" });
    const stories = field({ id: "f-stories", type: "number" });
    const when = field({ id: "f-when", type: "date" });

    expect(planFieldRows([sqft, stories, when])).toEqual([[sqft, stories], [when]]);
  });
});

describe("planFieldRows — picker-swapped fields keep the full row (#915)", () => {
  it("never pairs the insurance or referrer fields, whatever type the config gives them", () => {
    // The renderer quiet-swaps these maps_to targets for rich pickers
    // (InsuranceCompanyPicker #195, ReferrerPicker #302) regardless of the
    // configured type, so they must lay out as widgets, not compact inputs.
    const insurance = field({ id: "f-ins", type: "select", maps_to: "job.insurance_company" });
    const referrer = field({ id: "f-ref", type: "select", maps_to: "job.referral_partner_id" });
    const phone = field({ id: "f-phone", type: "phone" });

    expect(planFieldRows([insurance, phone, referrer])).toEqual([
      [insurance],
      [phone],
      [referrer],
    ]);
  });
});

describe("planFieldRows — free text and rich widgets keep the full row (#915)", () => {
  it("never pairs text, textarea, pill, or checkbox fields, even between compact neighbors", () => {
    const address = field({ id: "f-addr", type: "text" });
    const notes = field({ id: "f-notes", type: "textarea" });
    const urgency = field({ id: "f-urgency", type: "pill" });
    const consent = field({ id: "f-consent", type: "checkbox" });
    const date = field({ id: "f-date", type: "date" });

    expect(planFieldRows([address, date, notes, urgency, consent])).toEqual([
      [address],
      [date],
      [notes],
      [urgency],
      [consent],
    ]);
  });
});
