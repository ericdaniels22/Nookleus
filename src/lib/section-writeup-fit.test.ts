import { describe, expect, it } from "vitest";

import {
  measureWriteupFit,
  WRITEUP_CHARACTER_LIMIT,
} from "./section-writeup-fit";

describe("measureWriteupFit", () => {
  it("counts the visible characters of a simple write-up", () => {
    const fit = measureWriteupFit("<p>Hello</p>");
    expect(fit.used).toBe(5); // "Hello", not the surrounding <p> tags
    expect(fit.fits).toBe(true);
    expect(fit.remaining).toBe(fit.limit - 5);
  });

  it("treats a missing, empty, or whitespace-only write-up as zero used", () => {
    for (const empty of [
      null,
      undefined,
      "",
      "   ",
      "\n\t  ",
      "<p></p>",
      "<p>   </p>",
      "<ul><li></li></ul>",
    ]) {
      const fit = measureWriteupFit(empty);
      expect(fit.used).toBe(0);
      expect(fit.fits).toBe(true);
      expect(fit.remaining).toBe(fit.limit);
    }
  });

  it("counts decoded entities as one visible character each, not their source", () => {
    // "Mold & mildew" is 13 visible characters; the &amp; source is 5.
    expect(measureWriteupFit("<p>Mold &amp; mildew</p>").used).toBe(13);
    // < > " ' and a non-breaking space each render as a single character.
    expect(measureWriteupFit("<p>a &lt; b &gt; c</p>").used).toBe(
      "a < b > c".length,
    );
    expect(measureWriteupFit("<p>&quot;hi&quot;</p>").used).toBe('"hi"'.length);
    expect(measureWriteupFit("<p>it&#39;s</p>").used).toBe("it's".length);
    expect(measureWriteupFit("<p>a&nbsp;b</p>").used).toBe("a b".length);
  });

  it("counts only the visible text of inline and list markup, never the tags", () => {
    // Inline <strong>/<em> are weightless: "Soaked drywall" is 14 chars.
    expect(measureWriteupFit("<p>Soaked <strong>drywall</strong></p>").used).toBe(
      "Soaked drywall".length,
    );
    // Bullet text is counted; the <ul>/<li> scaffolding is not.
    expect(
      measureWriteupFit("<ul><li>Soaked</li><li>drywall</li></ul>").used,
    ).toBe("Soakeddrywall".length);
  });

  it("measures legacy plain text the way the PDF renders it, not as stray markup", () => {
    // A pre-rework one-line subtitle has no HTML tags. The PDF escapes it via
    // normalizeSectionWriteup and renders every character, so the fit module
    // must count all of them rather than delete "< 40F and humidity >" as if it
    // were a tag (the old greedy /<[^>]+>/ strip did exactly that).
    const legacy = "Temp < 40F and humidity > 80% in the basement";
    expect(measureWriteupFit(legacy).used).toBe(legacy.length);
  });

  it("keeps a stray '<' inside HTML, matching the renderer's tokenizer", () => {
    // Hand-authored / boilerplate HTML can carry a literal '<' that is not a
    // tag. The renderer's tokenizer keeps it as text; the count must too.
    expect(measureWriteupFit("<p>gap was < 2 inches</p>").used).toBe(
      "gap was < 2 inches".length,
    );
  });

  it("reports a write-up over the limit as not fitting, with negative remaining", () => {
    const fit = measureWriteupFit(`<p>${"a".repeat(20)}</p>`, 10);
    expect(fit.used).toBe(20);
    expect(fit.limit).toBe(10);
    expect(fit.fits).toBe(false);
    expect(fit.remaining).toBe(-10);
  });

  it("treats exactly the limit as fitting and one character over as not", () => {
    const at = measureWriteupFit(`<p>${"a".repeat(10)}</p>`, 10);
    expect(at.used).toBe(10);
    expect(at.fits).toBe(true);
    expect(at.remaining).toBe(0);

    const over = measureWriteupFit(`<p>${"a".repeat(11)}</p>`, 10);
    expect(over.used).toBe(11);
    expect(over.fits).toBe(false);
    expect(over.remaining).toBe(-1);
  });

  it("exposes a positive default one-page character limit in the result", () => {
    expect(WRITEUP_CHARACTER_LIMIT).toBeGreaterThan(0);
    expect(measureWriteupFit("<p>x</p>").limit).toBe(WRITEUP_CHARACTER_LIMIT);
  });
});
