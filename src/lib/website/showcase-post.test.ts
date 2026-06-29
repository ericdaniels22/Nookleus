import { describe, it, expect } from "vitest";
import { renderShowcaseBodyHtml } from "./showcase-post";

// #606 — the pure post-body renderer. A Showcase's hand-written write-up plus
// its ordered, already-public photo URLs become the WordPress post body HTML.
// Pure and separate from the REST client so the HTML shape is independently
// testable. Hot-links the public Supabase photo URLs (no media upload).

describe("renderShowcaseBodyHtml", () => {
  it("wraps the write-up in a paragraph and renders an <img> per photo in order", () => {
    const html = renderShowcaseBodyHtml({
      writeUp: "We rebuilt the roof after the storm.",
      photoUrls: ["https://cdn/photos/a.jpg", "https://cdn/photos/b.jpg"],
    });

    expect(html).toContain("<p>We rebuilt the roof after the storm.</p>");
    expect(html).toContain('<img src="https://cdn/photos/a.jpg"');
    expect(html).toContain('<img src="https://cdn/photos/b.jpg"');
    // Gallery order is meaningful — a comes before b.
    expect(html.indexOf("a.jpg")).toBeLessThan(html.indexOf("b.jpg"));
  });

  it("escapes HTML in the write-up so it cannot inject markup", () => {
    const html = renderShowcaseBodyHtml({
      writeUp: "We fixed <script>alert(1)</script> & more.",
      photoUrls: [],
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
  });

  it("renders just the write-up when there are no photos", () => {
    const html = renderShowcaseBodyHtml({
      writeUp: "A clean before/after.",
      photoUrls: [],
    });

    expect(html).toBe("<p>A clean before/after.</p>");
    expect(html).not.toContain("<figure>");
  });

  it("splits a blank-line-separated write-up into multiple paragraphs", () => {
    const html = renderShowcaseBodyHtml({
      writeUp: "First paragraph.\n\nSecond paragraph.",
      photoUrls: [],
    });

    expect(html).toContain("<p>First paragraph.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });
});
