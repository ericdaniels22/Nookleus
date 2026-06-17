import { describe, it, expect } from "vitest";

import { buildIntakeBuzz } from "./intake-buzz";

describe("buildIntakeBuzz", () => {
  it("builds an emergency buzz: 🚨 title with the customer name, body, sound, and deep link", () => {
    const buzz = buildIntakeBuzz({
      jobId: "job-1",
      customerName: "John Smith",
      urgency: "emergency",
      damageType: "Water damage",
      propertyAddress: "123 Main St",
    });

    expect(buzz).toEqual({
      title: "🚨 EMERGENCY intake: John Smith",
      body: "Water damage · 123 Main St",
      sound: "emergency.caf",
      href: "/jobs/job-1",
    });
  });

  describe("body degrades gracefully when damage type / address are missing", () => {
    const base = {
      jobId: "job-1",
      customerName: "John Smith",
      urgency: "scheduled" as const,
    };

    it("drops the missing address (no dangling separator)", () => {
      expect(
        buildIntakeBuzz({ ...base, damageType: "Water damage", propertyAddress: null }).body,
      ).toBe("Water damage");
    });

    it("drops the missing damage type", () => {
      expect(
        buildIntakeBuzz({ ...base, damageType: null, propertyAddress: "123 Main St" }).body,
      ).toBe("123 Main St");
    });

    it("treats blank/whitespace fields as missing", () => {
      expect(
        buildIntakeBuzz({ ...base, damageType: "   ", propertyAddress: "123 Main St" }).body,
      ).toBe("123 Main St");
    });

    it("falls back to a generic body when both are missing", () => {
      expect(
        buildIntakeBuzz({ ...base, damageType: null, propertyAddress: null }).body,
      ).toBe("New job");
    });
  });

  it("builds an urgent buzz (no 🚨 prefix, own sound)", () => {
    expect(
      buildIntakeBuzz({
        jobId: "job-2",
        customerName: "Jane Doe",
        urgency: "urgent",
        damageType: "Mold",
        propertyAddress: "5 Elm Rd",
      }),
    ).toEqual({
      title: "Urgent intake: Jane Doe",
      body: "Mold · 5 Elm Rd",
      sound: "urgent.caf",
      href: "/jobs/job-2",
    });
  });

  it("builds a scheduled buzz (default tier wording, own sound)", () => {
    expect(
      buildIntakeBuzz({
        jobId: "job-3",
        customerName: "Sam Lee",
        urgency: "scheduled",
        damageType: "Roof leak",
        propertyAddress: "12 Pine Ln",
      }),
    ).toEqual({
      title: "New intake: Sam Lee",
      body: "Roof leak · 12 Pine Ln",
      sound: "scheduled.caf",
      href: "/jobs/job-3",
    });
  });

  it("drops the trailing colon when the customer name is blank", () => {
    const buzz = buildIntakeBuzz({
      jobId: "job-1",
      customerName: "  ",
      urgency: "emergency",
      damageType: "Fire damage",
      propertyAddress: "9 Oak Ave",
    });
    expect(buzz.title).toBe("🚨 EMERGENCY intake");
  });
});
