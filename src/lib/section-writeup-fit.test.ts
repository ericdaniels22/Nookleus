import { describe, expect, it } from "vitest";

import { measureWriteupFit, writeupLimitFor } from "./section-writeup-fit";

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

  it("does not count <br> hard breaks toward the budget (characters, not lines)", () => {
    // The budget is deliberately character-based, not line-based (ADR 0009): a
    // write-up can stack many hard breaks and still measure only its visible
    // text. A <br> is dropped like any other tag — it adds no character and is
    // NOT turned into a space — so three visual lines count exactly as the same
    // text on one line. The budget errs lax: it never blocks on break-driven
    // height even though such a write-up could spill to a second page.
    expect(measureWriteupFit("<p>aaa<br>bbb<br>ccc</p>").used).toBe(9);
    expect(measureWriteupFit("<p>aaa<br>bbb<br>ccc</p>").used).toBe(
      measureWriteupFit("<p>aaabbbccc</p>").used,
    );
  });

  it("collapses a run of &nbsp; entities to a single space, mirroring HTML layout", () => {
    // HTML renders a run of non-breaking spaces as one space gap, and the budget
    // mirrors that (whitespace runs collapse to one space). Padding a write-up
    // with extra &nbsp; therefore never pads the count, regardless of how many
    // entities the run holds.
    expect(measureWriteupFit("<p>a&nbsp;&nbsp;&nbsp;b</p>").used).toBe(3); // "a b"
    expect(measureWriteupFit("<p>a&nbsp;&nbsp;&nbsp;b</p>").used).toBe(
      measureWriteupFit("<p>a&nbsp;b</p>").used,
    );
  });

  it("counts multi-paragraph text continuously, ignoring <p> block structure", () => {
    // Each paragraph adds vertical margin (height) in the PDF, but the budget
    // counts characters, not blocks: three short paragraphs measure exactly as
    // the same characters in a single paragraph. The block boundaries are
    // weightless, so a write-up of many short paragraphs can still run long.
    expect(measureWriteupFit("<p>AAA</p><p>BBB</p><p>CCC</p>").used).toBe(9);
    expect(measureWriteupFit("<p>AAA</p><p>BBB</p><p>CCC</p>").used).toBe(
      measureWriteupFit("<p>AAABBBCCC</p>").used,
    );
  });

  it("measures legacy plain text the way the PDF renders it, not as stray markup", () => {
    // A pre-rework one-line subtitle has no HTML tags. The PDF escapes it via
    // normalizeSectionWriteup and renders every character, so the fit module
    // must count all of them rather than delete "< 40F and humidity >" as if it
    // were a tag (the old greedy /<[^>]+>/ strip did exactly that).
    const legacy = "Temp < 40F and humidity > 80% in the basement";
    expect(measureWriteupFit(legacy).used).toBe(legacy.length);
  });

  it("counts an angle-bracketed legacy subtitle in full, not as stray markup (#445)", () => {
    // `<john@x.com>` looks like a tag to a loose detector, which used to drop
    // the bracketed address from both the PDF and this counter. It is escaped
    // legacy text now, so every character — brackets included — is counted.
    const legacy = "email me <john@x.com>";
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

  it("defaults the limit to the 2-per-page write-up cap (ADR 0014)", () => {
    // The single 1500-char budget is gone; measureWriteupFit with no explicit
    // limit now uses the 2-per-page cap, the densest write-up a 2-up page allows.
    expect(measureWriteupFit("<p>x</p>").limit).toBe(writeupLimitFor(2));
  });
});

describe("writeupLimitFor", () => {
  it("returns the per-layout write-up cap for each photos-per-page layout", () => {
    // Per ADR 0014: a 2-up page leaves the most room for prose, a 4-up the least.
    expect(writeupLimitFor(2)).toBe(750);
    expect(writeupLimitFor(3)).toBe(400);
    expect(writeupLimitFor(4)).toBe(260);
  });

  it("is exercised through measureWriteupFit as the limit it measures against", () => {
    // The cap a layout imposes is the same number measureWriteupFit checks the
    // visible-character count against — the builder passes writeupLimitFor(N) in.
    const body = `<p>${"a".repeat(401)}</p>`;
    const at3 = measureWriteupFit(body, writeupLimitFor(3));
    expect(at3.limit).toBe(400);
    expect(at3.fits).toBe(false); // 401 visible chars over the 3-up cap of 400
    const at2 = measureWriteupFit(body, writeupLimitFor(2));
    expect(at2.fits).toBe(true); // same body fits under the looser 2-up cap of 750
  });
});
