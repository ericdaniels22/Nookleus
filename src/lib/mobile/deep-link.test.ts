import { describe, expect, it } from "vitest";

import { parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("routes the New job action to the intake flow", () => {
    expect(parseDeepLink("nookleus://new-job")).toBe("/intake");
  });

  it("routes the Add photo action to the photos hub", () => {
    expect(parseDeepLink("nookleus://add-photo")).toBe("/photos");
  });

  it("routes the Compose email action to the email composer", () => {
    expect(parseDeepLink("nookleus://compose-email")).toBe("/email?compose=1");
  });

  it("routes the Open Jarvis action to the Jarvis chat", () => {
    expect(parseDeepLink("nookleus://jarvis")).toBe("/jarvis");
  });

  it("returns null for an unrecognized action", () => {
    expect(parseDeepLink("nookleus://settings")).toBeNull();
  });

  it("ignores input that does not use the nookleus:// scheme", () => {
    expect(parseDeepLink("new-job")).toBeNull();
    expect(parseDeepLink("https://aaaplatform.vercel.app/intake")).toBeNull();
    expect(parseDeepLink("")).toBeNull();
  });

  it("tolerates a trailing slash or path after the action", () => {
    expect(parseDeepLink("nookleus://jarvis/")).toBe("/jarvis");
  });

  // Emails widget (#174) deep links — the widget emits `nookleus://email`
  // with a query param identifying what to open.
  it("routes a widget email link with an account to that account's inbox", () => {
    expect(parseDeepLink("nookleus://email?account=acc-1")).toBe(
      "/email?account=acc-1",
    );
  });

  it("routes a widget email link with an id to that specific email", () => {
    expect(parseDeepLink("nookleus://email?id=msg-9")).toBe("/email?id=msg-9");
  });

  it("routes a bare widget email link to the inbox", () => {
    expect(parseDeepLink("nookleus://email")).toBe("/email");
  });
});
