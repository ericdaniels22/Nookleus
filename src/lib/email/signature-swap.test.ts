import { describe, it, expect } from "vitest";
import { swapSignature, SIGNATURE_BLOCK_ATTR } from "./signature-swap";

describe("swapSignature", () => {
  it("applies a signature to an empty body", () => {
    const result = swapSignature("", "<p>Jane Doe</p>");
    expect(result).toContain("Jane Doe");
    expect(result).toContain(SIGNATURE_BLOCK_ATTR);
  });

  it("swaps one signature for another while preserving typed content", () => {
    const initial = swapSignature("<p>Hello there</p>", "<p>Sig A</p>");
    const swapped = swapSignature(initial, "<p>Sig B</p>");
    expect(swapped).toContain("Hello there");
    expect(swapped).toContain("Sig B");
    expect(swapped).not.toContain("Sig A");
  });

  it("removes the signature region when the next signature is null", () => {
    const withSig = swapSignature("<p>Hello there</p>", "<p>Sig A</p>");
    const removed = swapSignature(withSig, null);
    expect(removed).toContain("Hello there");
    expect(removed).not.toContain("Sig A");
    expect(removed).not.toContain(SIGNATURE_BLOCK_ATTR);
  });

  it("leaves a body with no signature unchanged when none is provided", () => {
    const body = "<p>Just a message</p>";
    expect(swapSignature(body, null)).toBe(body);
  });

  it("locates the region correctly when the signature contains nested markup", () => {
    // A logo signature with nested <div>s, and a quoted reply BELOW the
    // signature (compose inserts the signature above the quoted thread).
    const logoSig =
      '<div class="logo"><img src="x"><span>Jane</span></div><p>Acme Inc</p>';
    const body =
      swapSignature("<p>Message body</p>", logoSig) + "<p>Quoted reply</p>";
    const swapped = swapSignature(body, "<p>New sig</p>");
    expect(swapped).toContain("Message body");
    expect(swapped).toContain("Quoted reply");
    expect(swapped).toContain("New sig");
    expect(swapped).not.toContain("Acme Inc");
    expect(swapped).not.toContain("Jane");
  });
});
