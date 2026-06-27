import { describe, expect, it } from "vitest";

import { isValidRecipientEmail } from "./recipient";

describe("isValidRecipientEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidRecipientEmail("foo@bar.com")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isValidRecipientEmail("  foo@bar.com  ")).toBe(true);
  });

  // The two cases the issue calls out explicitly (finding L14): the old
  // `.includes("@")` check let both through.
  it("rejects a missing domain (foo@)", () => {
    expect(isValidRecipientEmail("foo@")).toBe(false);
  });

  it("rejects interior whitespace (a b@c)", () => {
    expect(isValidRecipientEmail("a b@c")).toBe(false);
  });

  it("rejects a dotless domain (a@b)", () => {
    expect(isValidRecipientEmail("a@b")).toBe(false);
  });

  it("rejects a missing local part (@x.com)", () => {
    expect(isValidRecipientEmail("@x.com")).toBe(false);
  });

  it("rejects a string with no @", () => {
    expect(isValidRecipientEmail("foobar.com")).toBe(false);
  });

  it("rejects two @ signs", () => {
    expect(isValidRecipientEmail("a@b@c.com")).toBe(false);
  });

  it("rejects empty / whitespace-only input", () => {
    expect(isValidRecipientEmail("")).toBe(false);
    expect(isValidRecipientEmail("   ")).toBe(false);
  });
});
