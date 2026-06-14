import { describe, it, expect } from "vitest";
import {
  swapSignature,
  renderSignatureRegion,
  hasSignatureRegion,
  SIGNATURE_BLOCK_ATTR,
} from "./signature-swap";

/** Count rendered signature regions by their emitted marker attribute. */
function countRegions(html: string): number {
  return (html.match(new RegExp(`${SIGNATURE_BLOCK_ATTR}="true"`, "g")) || [])
    .length;
}

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

  it("does not mistake HTML that merely contains the marker substring for the region", () => {
    // Pasted/quoted email HTML whose class CONTAINS the `data-signature-block`
    // substring (here as a hyphenated suffix), but is NOT the real
    // `data-signature-block="true"` attribute. A swap must leave it intact and
    // append the new signature, not destroy the pasted content.
    const pasted =
      '<div class="data-signature-block-wrapper"><p>Quoted thread content</p></div>';
    const result = swapSignature(pasted, "<p>My signature</p>");
    expect(result).toContain("Quoted thread content");
    expect(result).toContain("My signature");
  });

  it("ignores the marker substring in an id or another attribute's value", () => {
    // No REAL region: the substring lives in an id and inside a class value. A
    // swap must leave both decoys intact and append exactly one new region.
    const decoys =
      '<div id="data-signature-block"><p>Decoy A</p></div>' +
      '<div class="x data-signature-block y"><p>Decoy B</p></div>';
    const result = swapSignature(decoys, "<p>Real sig</p>");
    expect(result).toContain("Decoy A");
    expect(result).toContain("Decoy B");
    expect(countRegions(result)).toBe(1);
  });

  it("collapses to a single region when the body already has duplicates", () => {
    // A legacy double-inserted draft (the resume bug) or an orphaned region can
    // leave two marker regions. A swap replaces ONE and strips the rest, so
    // exactly one signature ever survives — it is never shipped twice.
    const twoRegions =
      "<p>Body</p>" +
      renderSignatureRegion("<p>Old A</p>") +
      renderSignatureRegion("<p>Old B</p>");
    const result = swapSignature(twoRegions, "<p>New sig</p>");
    expect(countRegions(result)).toBe(1);
    expect(result).toContain("Body");
    expect(result).toContain("New sig");
    expect(result).not.toContain("Old A");
    expect(result).not.toContain("Old B");
  });

  it("removes every region when clearing the signature, even duplicates", () => {
    const twoRegions =
      renderSignatureRegion("<p>Old A</p>") +
      "<p>Body</p>" +
      renderSignatureRegion("<p>Old B</p>");
    const result = swapSignature(twoRegions, null);
    expect(countRegions(result)).toBe(0);
    expect(result).toContain("Body");
  });

  it("replaces a single existing region in place rather than appending", () => {
    // A plain in-place swap of one well-formed region stays at one region.
    // (The orphaned/duplicate-region case is guarded by the "collapses to a
    // single region" test above, which constructs two real regions.)
    const withSig = swapSignature("<p>Message</p>", "<p>First</p>");
    const swapped = swapSignature(withSig, "<p>Second</p>");
    expect(countRegions(swapped)).toBe(1);
    expect(swapped).toContain("Second");
    expect(swapped).not.toContain("First");
  });
});

describe("hasSignatureRegion", () => {
  it("is true only for the real marker, not a substring decoy", () => {
    expect(hasSignatureRegion(renderSignatureRegion("<p>Sig</p>"))).toBe(true);
    expect(hasSignatureRegion("<p>Just a message</p>")).toBe(false);
    expect(
      hasSignatureRegion('<div class="data-signature-block-x"><p>Q</p></div>'),
    ).toBe(false);
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
