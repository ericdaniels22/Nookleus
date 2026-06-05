import { describe, expect, it } from "vitest";

import { normalizeSectionWriteup } from "./section-writeup";

describe("normalizeSectionWriteup", () => {
  it("returns an empty string for a missing write-up (null or undefined)", () => {
    expect(normalizeSectionWriteup(null)).toBe("");
    expect(normalizeSectionWriteup(undefined)).toBe("");
  });

  it("treats an empty or whitespace-only write-up as empty", () => {
    expect(normalizeSectionWriteup("")).toBe("");
    expect(normalizeSectionWriteup("   ")).toBe("");
    expect(normalizeSectionWriteup("\n\t  ")).toBe("");
  });

  it("wraps a legacy plain-text line as a single paragraph", () => {
    expect(normalizeSectionWriteup("Water damage in the kitchen")).toBe(
      "<p>Water damage in the kitchen</p>",
    );
  });

  it("escapes HTML-special characters in legacy plain text", () => {
    expect(normalizeSectionWriteup("temp < 5 & humidity > 80")).toBe(
      "<p>temp &lt; 5 &amp; humidity &gt; 80</p>",
    );
  });

  it("passes an existing rich-text HTML write-up through unchanged", () => {
    const html =
      "<p>Findings:</p><ul><li>Soaked drywall</li><li>Mold &amp; mildew</li></ul>";
    expect(normalizeSectionWriteup(html)).toBe(html);
  });

  it("recognizes a single formatted paragraph as rich text, not plain", () => {
    const html = "<p>Significant <strong>water</strong> damage</p>";
    expect(normalizeSectionWriteup(html)).toBe(html);
  });

  it("treats a heading-only write-up as rich text, not plain (no wholesale escaping)", () => {
    // The bare-StarterKit editor can emit a heading with no wrapping <p> (e.g.
    // typing "## Findings"). It must reach the renderer as HTML, not be escaped
    // and shown to the customer as literal `<h2>…</h2>` source.
    const html = "<h2>Findings</h2>";
    expect(normalizeSectionWriteup(html)).toBe(html);
  });

  it("treats a code-block-only write-up as rich text, not plain", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    expect(normalizeSectionWriteup(html)).toBe(html);
  });
});
