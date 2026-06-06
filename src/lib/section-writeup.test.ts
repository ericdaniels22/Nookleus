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

  it("treats a legacy subtitle with an angle-bracketed email as plain text (#445)", () => {
    // `<john@x.com>` is not a recognized editor tag. The old loose pattern
    // matched any letter-led `<…>` and returned it unescaped, so the PDF
    // tokenizer then dropped the bracketed address as if it were a tag. It must
    // be escaped and wrapped so every character survives.
    expect(normalizeSectionWriteup("email me <john@x.com>")).toBe(
      "<p>email me &lt;john@x.com&gt;</p>",
    );
  });

  it("treats legacy prose with a stray closing tag as plain text (#445)", () => {
    // `</p>` names a recognized tag, but a lone close tag is never genuine
    // editor output — real write-ups always open a block first. Detection keys
    // off a recognized OPENING tag, so this falls through to escape-and-wrap
    // instead of being passed through and dropped by the tokenizer.
    expect(normalizeSectionWriteup("see the </p> example")).toBe(
      "<p>see the &lt;/p&gt; example</p>",
    );
  });

  it("treats legacy prose mentioning an unknown tag as plain text (#445)", () => {
    // `<div>` is a real HTML tag but not one the editor emits, so prose that
    // happens to name it stays plain text rather than being passed through and
    // having the bracketed span eaten by the tokenizer.
    expect(normalizeSectionWriteup("use <div> tags for layout")).toBe(
      "<p>use &lt;div&gt; tags for layout</p>",
    );
  });

  it("still passes genuine editor HTML (list, emphasis) through richly (#445)", () => {
    // The narrower detector must not regress real editor output: an opening
    // recognized tag still marks the value as rich text, untouched.
    expect(normalizeSectionWriteup("<ol><li>First</li><li>Second</li></ol>")).toBe(
      "<ol><li>First</li><li>Second</li></ol>",
    );
    expect(normalizeSectionWriteup("<p>Some <em>emphasis</em> here</p>")).toBe(
      "<p>Some <em>emphasis</em> here</p>",
    );
  });
});
