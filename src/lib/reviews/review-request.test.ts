import { describe, it, expect } from "vitest";

import {
  buildReviewLink,
  buildReviewRequestMessage,
  selectReviewRequestChannel,
  summarizePriorReviewRequests,
} from "./review-request";

describe("buildReviewLink", () => {
  it("returns the Business Profile newReviewUri verbatim when present", () => {
    expect(
      buildReviewLink({ newReviewUri: "https://g.page/r/abc123/review" }),
    ).toBe("https://g.page/r/abc123/review");
  });

  it("builds a writereview URL from the Place ID when no newReviewUri", () => {
    expect(buildReviewLink({ placeId: "ChIJ_place_id" })).toBe(
      "https://search.google.com/local/writereview?placeid=ChIJ_place_id",
    );
  });

  it("returns null when neither a review URI nor a Place ID is available", () => {
    expect(buildReviewLink({})).toBeNull();
    expect(buildReviewLink({ newReviewUri: null, placeId: null })).toBeNull();
  });

  it("treats blank/whitespace metadata as absent", () => {
    expect(buildReviewLink({ newReviewUri: "   ", placeId: "  " })).toBeNull();
    // a blank newReviewUri still falls through to a usable Place ID
    expect(buildReviewLink({ newReviewUri: " ", placeId: "ChIJ_x" })).toBe(
      "https://search.google.com/local/writereview?placeid=ChIJ_x",
    );
  });
});

describe("selectReviewRequestChannel", () => {
  it("sends by SMS to the normalized E.164 number when the phone is usable", () => {
    expect(
      selectReviewRequestChannel({ phone: "(212) 555-0142", email: null }),
    ).toEqual({ channel: "sms", to: "+12125550142" });
  });

  it("falls back to email when there is no usable phone", () => {
    // no phone at all
    expect(
      selectReviewRequestChannel({ phone: null, email: "  jo@acme.com " }),
    ).toEqual({ channel: "email", to: "jo@acme.com" });
    // a phone that does not normalize must not block the email fallback
    expect(
      selectReviewRequestChannel({ phone: "123", email: "jo@acme.com" }),
    ).toEqual({ channel: "email", to: "jo@acme.com" });
  });

  it("reports no contact method when there is no usable phone or email", () => {
    expect(selectReviewRequestChannel({ phone: null, email: null })).toEqual({
      channel: "none",
      reason: "no_contact_method",
    });
    // whitespace-only email is not a usable address
    expect(selectReviewRequestChannel({ phone: "", email: "   " })).toEqual({
      channel: "none",
      reason: "no_contact_method",
    });
  });
});

describe("buildReviewRequestMessage", () => {
  it("builds an SMS body containing the business name and review link", () => {
    const msg = buildReviewRequestMessage({
      channel: "sms",
      businessName: "AAA Contracting",
      reviewLink: "https://g.page/r/abc/review",
    });
    expect(msg.subject).toBeUndefined();
    expect(msg.body).toContain("AAA Contracting");
    expect(msg.body).toContain("https://g.page/r/abc/review");
  });

  it("builds an email with a subject and a body carrying the link", () => {
    const msg = buildReviewRequestMessage({
      channel: "email",
      businessName: "AAA Contracting",
      reviewLink: "https://g.page/r/abc/review",
    });
    expect(msg.subject).toBeTruthy();
    expect(msg.subject).toContain("AAA Contracting");
    expect(msg.body).toContain("https://g.page/r/abc/review");
  });

  it("greets the customer by first name when a name is provided", () => {
    const msg = buildReviewRequestMessage({
      channel: "sms",
      businessName: "AAA Contracting",
      reviewLink: "https://g.page/r/abc/review",
      customerName: "Jo Smith",
    });
    expect(msg.body).toContain("Hi Jo");
    // first name only — don't address them by their full name
    expect(msg.body).not.toContain("Smith");
  });

  it("uses a generic greeting when no customer name is provided", () => {
    const msg = buildReviewRequestMessage({
      channel: "sms",
      businessName: "AAA Contracting",
      reviewLink: "https://g.page/r/abc/review",
      customerName: "   ",
    });
    expect(msg.body).toContain("Hi there");
    expect(msg.body).toContain("AAA Contracting");
  });
});

describe("summarizePriorReviewRequests", () => {
  it("reports nothing requested for an empty history", () => {
    expect(summarizePriorReviewRequests([])).toEqual({
      alreadyRequested: false,
      count: 0,
      last: null,
    });
  });

  it("flags a single prior request and returns it as the last", () => {
    const row = {
      channel: "sms" as const,
      created_at: "2026-06-01T10:00:00Z",
      sender_name: "Eric",
    };
    expect(summarizePriorReviewRequests([row])).toEqual({
      alreadyRequested: true,
      count: 1,
      last: row,
    });
  });

  it("picks the most recent request as the last, ignoring array order", () => {
    const older = { channel: "email" as const, created_at: "2026-05-01T09:00:00Z" };
    const newest = { channel: "sms" as const, created_at: "2026-06-15T14:30:00Z" };
    const middle = { channel: "sms" as const, created_at: "2026-06-01T08:00:00Z" };
    const summary = summarizePriorReviewRequests([older, newest, middle]);
    expect(summary.count).toBe(3);
    expect(summary.alreadyRequested).toBe(true);
    expect(summary.last).toBe(newest);
  });
});
