import { describe, it, expect } from "vitest";
import { scrubShowcaseForPublish, scrubBlockMessage } from "./showcase-scrub";

// #606 — the publish-time privacy scrub. A Showcase goes onto the org's PUBLIC
// website, so before it is pushed the hand-written title + write-up are checked
// for the two identifying details ADR 0015 keeps off a public post: the Job's
// customer name (contacts.full_name) and its street address (jobs.property_address).
// City-level location is allowed. The guard is pure — it takes the text + the two
// needles and reports whether to block, what leaked, and a clear message.

describe("scrubShowcaseForPublish", () => {
  it("blocks when the write-up contains the customer's full name", () => {
    const result = scrubShowcaseForPublish({
      title: "Storm damage roof rebuild",
      writeUp: "We worked with John Smith to restore the roof after the storm.",
      customerName: "John Smith",
      propertyAddress: "123 Main Street, Springfield, IL 62701",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations).toContainEqual({
      field: "customer_name",
      match: "John Smith",
    });
  });

  it("blocks when the write-up contains the street address (street line)", () => {
    const result = scrubShowcaseForPublish({
      title: "Kitchen remodel",
      writeUp: "The crew rebuilt the kitchen at 123 Main Street over two weeks.",
      customerName: "Jane Doe",
      propertyAddress: "123 Main Street, Springfield, IL 62701",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations).toContainEqual({
      field: "address",
      match: "123 Main Street",
    });
  });

  it("allows a city-only mention (city-level location is public)", () => {
    const result = scrubShowcaseForPublish({
      title: "Roof rebuild in Springfield",
      writeUp:
        "A complete roof rebuild for a homeowner in Springfield after the spring storms.",
      customerName: "Jane Doe",
      propertyAddress: "123 Main Street, Springfield, IL 62701",
    });

    expect(result.blocked).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("reports both the customer name and the street address when both leak", () => {
    const result = scrubShowcaseForPublish({
      title: "John Smith's roof at 123 Main Street",
      writeUp: "Before and after.",
      customerName: "John Smith",
      propertyAddress: "123 Main Street, Springfield, IL 62701",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        { field: "customer_name", match: "John Smith" },
        { field: "address", match: "123 Main Street" },
      ]),
    );
    expect(result.violations).toHaveLength(2);
  });

  it("matches case- and whitespace-insensitively", () => {
    const result = scrubShowcaseForPublish({
      title: "Project recap",
      writeUp: "Thanks to\n  JOHN   SMITH  for trusting us.",
      customerName: "John Smith",
      propertyAddress: "9 Oak Ave, Dayton, OH",
    });

    expect(result.blocked).toBe(true);
    expect(result.violations).toContainEqual({
      field: "customer_name",
      match: "John Smith",
    });
  });

  it("does not block when the customer name and address are empty", () => {
    const result = scrubShowcaseForPublish({
      title: "Anonymous before/after",
      writeUp: "A great transformation with no identifying details.",
      customerName: "",
      propertyAddress: "",
    });

    expect(result.blocked).toBe(false);
    expect(result.violations).toEqual([]);
  });
});

describe("scrubBlockMessage", () => {
  it("names the customer name and street address that must be removed", () => {
    const message = scrubBlockMessage([
      { field: "customer_name", match: "John Smith" },
      { field: "address", match: "123 Main Street" },
    ]);

    expect(message).toContain("John Smith");
    expect(message).toContain("123 Main Street");
    // It tells the admin what to do, and why only city-level is allowed.
    expect(message.toLowerCase()).toContain("remove");
    expect(message.toLowerCase()).toContain("city");
  });

  it("names only the field that leaked", () => {
    const message = scrubBlockMessage([
      { field: "customer_name", match: "Jane Doe" },
    ]);

    expect(message).toContain("Jane Doe");
    expect(message).not.toContain("address");
  });
});
