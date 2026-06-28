import { describe, it, expect, afterEach } from "vitest";
import { isGoogleOAuthTestingMode } from "./config";

// #789 — the consent screen for project `nookleus` starts in "Testing", where
// the business.manage refresh token expires 7 days after consent. This flag
// lets the UI warn while that's true and go quiet once published to Production.
describe("isGoogleOAuthTestingMode", () => {
  const KEY = "GOOGLE_OAUTH_TESTING_MODE";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("defaults to true when unset (the consent screen starts in Testing)", () => {
    delete process.env[KEY];
    expect(isGoogleOAuthTestingMode()).toBe(true);
  });

  it("is false once published to Production (GOOGLE_OAUTH_TESTING_MODE=false)", () => {
    process.env[KEY] = "false";
    expect(isGoogleOAuthTestingMode()).toBe(false);
  });

  it("treats 'production' as the published signal", () => {
    process.env[KEY] = "production";
    expect(isGoogleOAuthTestingMode()).toBe(false);
  });

  it("stays true for an explicit 'true'", () => {
    process.env[KEY] = "true";
    expect(isGoogleOAuthTestingMode()).toBe(true);
  });

  it("ignores surrounding whitespace and case", () => {
    process.env[KEY] = "  FALSE  ";
    expect(isGoogleOAuthTestingMode()).toBe(false);
  });
});
