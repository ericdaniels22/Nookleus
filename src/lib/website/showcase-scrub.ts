// #606 — the publish-time privacy scrub for a Showcase.
//
// A Showcase is pushed to the Organization's PUBLIC website, so ADR 0015 keeps
// two identifying details off the post: the Job's customer name
// (contacts.full_name) and its street address (jobs.property_address).
// City-level location is fine. This guard is PURE — given the hand-written
// title + write-up and the two needles, it reports whether to block, exactly
// what leaked, and a message the admin can act on. The publish route runs it
// as a hard gate before any WordPress call.

export interface ScrubInput {
  title: string;
  writeUp: string;
  // The Job's customer, contacts.full_name (joined via jobs.contact_id).
  customerName: string;
  // The Job's street address, jobs.property_address (one free-text field).
  propertyAddress: string;
}

export type ScrubField = "customer_name" | "address";

export interface ScrubViolation {
  field: ScrubField;
  // The offending value, as given — what the admin must remove from the text.
  match: string;
}

export interface ScrubResult {
  blocked: boolean;
  violations: ScrubViolation[];
}

// Case- and whitespace-fold so "John  Smith" in the text matches "John Smith"
// the needle regardless of casing or runs of spaces / newlines.
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function scrubShowcaseForPublish(input: ScrubInput): ScrubResult {
  const haystack = normalize(`${input.title} ${input.writeUp}`);
  const violations: ScrubViolation[] = [];

  const name = input.customerName.trim();
  if (name && haystack.includes(normalize(name))) {
    violations.push({ field: "customer_name", match: name });
  }

  // The address needle is the STREET LINE — the part before the first comma —
  // and only when it carries a house number (a digit). That blocks "123 Main
  // Street" while leaving the city/state ("Springfield, IL") publishable, per
  // ADR 0015's city-level-only rule.
  const streetLine = input.propertyAddress.split(",")[0].trim();
  if (/\d/.test(streetLine) && haystack.includes(normalize(streetLine))) {
    violations.push({ field: "address", match: streetLine });
  }

  return { blocked: violations.length > 0, violations };
}

// The admin-facing message for a blocked publish: it names exactly what leaked
// (so they can find and delete it) and why only city-level location is public.
// Pure and separate from the gate so the route can render it verbatim.
export function scrubBlockMessage(violations: ScrubViolation[]): string {
  const parts = violations.map((v) =>
    v.field === "customer_name"
      ? `the customer's name ("${v.match}")`
      : `the street address ("${v.match}")`,
  );
  const subject = parts.join(" and ");
  const them = violations.length > 1 ? "them" : "it";
  return `This Showcase still shows ${subject}. Remove ${them} before publishing — only city-level location may be public.`;
}
