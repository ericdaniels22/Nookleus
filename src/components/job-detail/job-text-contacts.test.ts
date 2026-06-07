// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page Messages section.
//
// `buildJobTextContacts` maps a Job to the contact list the Messages
// section's Text button offers. Confirmed design (issue #311): the
// homeowner is the default (first), followed by the Job's adjusters with
// the PRIMARY adjuster ahead of the rest. Insurance and HOA contacts are
// intentionally excluded — you don't text the carrier or the HOA from a
// Job. The section itself filters this list down to those with a phone.

import { describe, it, expect } from "vitest";
import type { Job, Contact } from "@/lib/types";
import { buildJobTextContacts } from "./job-text-contacts";

// Minimal Contact — the builder only reads id/full_name/phone.
function contact(over: Partial<Contact>): Contact {
  return {
    id: "c",
    full_name: "x",
    phone: null,
    ...over,
  } as Contact;
}

describe("buildJobTextContacts", () => {
  it("lists the homeowner first, then adjusters with the primary ahead of the rest", () => {
    const job = {
      contact: contact({ id: "home", full_name: "Homer Owner", phone: "+15125550001" }),
      job_adjusters: [
        // Deliberately out of order: a non-primary listed before the primary.
        { id: "ja2", is_primary: false, adjuster: contact({ id: "adj2", full_name: "Sec Ondary", phone: "+15125550003" }) },
        { id: "ja1", is_primary: true, adjuster: contact({ id: "adj1", full_name: "Pri Mary", phone: "+15125550002" }) },
      ],
    } as unknown as Job;

    const result = buildJobTextContacts(job);

    expect(result.map((c) => c.id)).toEqual(["home", "adj1", "adj2"]);
    expect(result[0]).toEqual({ id: "home", name: "Homer Owner", phone: "+15125550001" });
    expect(result[1]).toEqual({ id: "adj1", name: "Pri Mary", phone: "+15125550002" });
  });

  it("skips adjuster rows with no joined contact and passes a null phone through", () => {
    const job = {
      contact: contact({ id: "home", full_name: "Homer Owner", phone: null }),
      job_adjusters: [
        { id: "ja1", is_primary: true, adjuster: contact({ id: "adj1", full_name: "Pri Mary", phone: null }) },
        // A join that didn't resolve (RLS-hidden or deleted contact) — skip it.
        { id: "ja-orphan", is_primary: false, adjuster: undefined },
      ],
    } as unknown as Job;

    const result = buildJobTextContacts(job);

    expect(result.map((c) => c.id)).toEqual(["home", "adj1"]);
    // A phone-less contact is still listed (the section filters textables);
    // its null phone is preserved verbatim.
    expect(result[0].phone).toBeNull();
    expect(result[1].phone).toBeNull();
  });

  it("returns an empty list for a job with neither a contact nor adjusters", () => {
    expect(buildJobTextContacts({} as Job)).toEqual([]);
  });
});
