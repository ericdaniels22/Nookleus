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
});
