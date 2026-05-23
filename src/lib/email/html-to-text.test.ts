import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-to-text";

// Issue #212 — Job View's sent-email body was a wall of text because the
// compose flow derived body_text via DOM `textContent`, which silently drops
// every `<p>` and `<br>` boundary. The fix routes body_text through
// htmlToText() instead; these tests pin the newline semantics that the
// bug fix depends on so a future "simplification" can't quietly regress it.
describe("htmlToText", () => {
  it("turns a paragraph boundary into a blank line", () => {
    expect(htmlToText("<p>first</p><p>second</p>")).toBe("first\n\nsecond");
  });

  it("turns a <br> into a single newline inside a paragraph", () => {
    expect(htmlToText("<p>line one<br>line two</p>")).toBe("line one\nline two");
  });

  it("preserves multi-paragraph spacing in a realistic email body", () => {
    const html = "<p>Hi Jane,</p><p>Please find the report attached.<br>Let me know if you have questions.</p><p>Thanks,<br>Eric</p>";
    expect(htmlToText(html)).toBe(
      "Hi Jane,\n\nPlease find the report attached.\nLet me know if you have questions.\n\nThanks,\nEric",
    );
  });

  it("decodes the five HTML entities the encoder produces", () => {
    expect(htmlToText("<p>5 &amp; 6 &lt; 7 &gt; 4 &quot;ok&quot; it&#39;s</p>"))
      .toBe(`5 & 6 < 7 > 4 "ok" it's`);
  });
});
