import { describe, it, expect } from "vitest";
import {
  sanitizeEmailHtmlForSend,
  sanitizeEmailHtmlForStorage,
} from "./sanitize-email-html";
import {
  renderSignatureRegion,
  hasSignatureRegion,
  swapSignature,
} from "./signature-swap";

// The send path is the security boundary: body HTML POSTed directly to the API
// bypasses the client Tiptap round-trip, so a `<script>` payload must be
// neutralized server-side before it is emailed (issue #658 M3).
describe("sanitizeEmailHtmlForSend", () => {
  it("strips <script> tags", () => {
    const out = sanitizeEmailHtmlForSend(
      '<p>Hi</p><script>alert("xss")</script>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
    expect(out).toContain("<p>Hi</p>");
  });

  it("strips inline event-handler attributes (onclick/onerror)", () => {
    const out = sanitizeEmailHtmlForSend('<p onclick="steal()">Hi</p>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("steal");
    expect(out).toContain("Hi");
  });

  it("neutralizes javascript: URLs in links", () => {
    const out = sanitizeEmailHtmlForSend(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  // The allowlist must keep what the compose Tiptap editor legitimately
  // produces (issue #642): font size / color come through as styled <span>s.
  it("preserves textStyle font-size and color spans", () => {
    const out = sanitizeEmailHtmlForSend(
      '<p><span style="font-size: 20px; color: #ff0000">big red</span></p>',
    );
    expect(out).toContain("big red");
    expect(out).toContain("font-size");
    expect(out).toContain("20px");
    expect(out).toContain("color");
  });

  // Images are first-class in compose: http(s) URLs and pasted base64 data URIs
  // (editor allowBase64) must survive, but an `onerror` handler must not.
  it("keeps safe http and base64 <img> but strips onerror", () => {
    const http = sanitizeEmailHtmlForSend('<img src="https://x.test/a.png" alt="a">');
    expect(http).toContain('src="https://x.test/a.png"');

    const base64 = sanitizeEmailHtmlForSend(
      '<img src="data:image/png;base64,iVBORw0KGgo=">',
    );
    expect(base64).toContain("data:image/png;base64");

    const evil = sanitizeEmailHtmlForSend(
      '<img src="x" onerror="steal()">',
    );
    expect(evil).not.toContain("onerror");
    expect(evil).not.toContain("steal");
  });

  // L5: internal round-trip markers must not ship in outgoing mail, but the
  // visual styling they carried (the signature separator, the indent) must.
  it("strips internal markers on send while keeping their visual styling", () => {
    const out = sanitizeEmailHtmlForSend(
      '<div data-signature-block="true" style="border-top: 1px solid #ccc; padding-top: 8px">' +
        "<p>Jane</p></div>" +
        '<p data-indent="2" style="margin-left: 80px">indented</p>',
    );
    expect(out).not.toContain("data-signature-block");
    expect(out).not.toContain("data-indent");
    // The separator + indent appearance survives.
    expect(out).toContain("border-top");
    expect(out).toContain("margin-left");
    expect(out).toContain("Jane");
  });
});

// The storage path (draft save, template write) is the same allowlist, but it
// must KEEP the round-trip markers: a resumed draft re-locates its signature
// region by the `data-signature-block` marker (issue #656), so stripping it
// here would orphan the region and break signature swapping.
describe("sanitizeEmailHtmlForStorage", () => {
  it("preserves internal round-trip markers while still sanitizing", () => {
    const out = sanitizeEmailHtmlForStorage(
      '<div data-signature-block="true" style="border-top: 1px solid #ccc"><p>Jane</p></div>' +
        '<p data-indent="2" style="margin-left: 80px">x</p>' +
        "<script>alert(1)</script>",
    );
    expect(out).toContain("data-signature-block");
    expect(out).toContain("data-indent");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  // The contract storage sanitization must not break: a draft saved through it
  // and later resumed must still have a locatable, swappable signature region.
  it("keeps a signature region locatable and swappable after sanitizing", () => {
    const body =
      "<p>Hello</p>" + renderSignatureRegion("<p>Jane Doe</p>");
    const stored = sanitizeEmailHtmlForStorage(body);

    expect(hasSignatureRegion(stored)).toBe(true);
    const swapped = swapSignature(stored, "<p>New Sig</p>");
    expect(swapped).toContain("New Sig");
    expect(swapped).not.toContain("Jane Doe");
    expect(swapped).toContain("Hello");
  });
});

// Regressions from the #658 adversarial review: payloads that survived the
// first cut of the allowlist (PR #665) and drove two follow-up hardenings —
// invisible-character scheme smuggling, and SVG/non-raster data-URI images.
describe("sanitizeEmailHtml — adversarial hardenings (#658 review)", () => {
  it("drops a scheme hidden behind a leading BOM / zero-width char", () => {
    // A leading U+FEFF (or a U+200B inside the scheme) defeats sanitize-html's
    // scheme check, but a browser strips it on click — a parser-differential XSS.
    const bom = sanitizeEmailHtmlForSend(
      '<a href="\uFEFFjavascript:alert(1)">c</a>',
    );
    expect(bom).not.toMatch(/javascript:/i);
    expect(bom).not.toContain("alert");
    expect(bom).toContain("c");

    const zwsp = sanitizeEmailHtmlForSend(
      '<a href="java\u200Bscript:alert(1)">c</a>',
    );
    expect(zwsp).not.toMatch(/javascript:/i);

    const vb = sanitizeEmailHtmlForSend(
      '<a href="\uFEFFvbscript:msgbox(1)">c</a>',
    );
    expect(vb).not.toMatch(/vbscript:/i);
  });

  it("leaves a clean URL untouched (the noise-strip is lossless)", () => {
    const ok = sanitizeEmailHtmlForSend(
      '<a href="https://example.com/path?q=1">c</a>',
    );
    expect(ok).toContain('href="https://example.com/path?q=1"');
  });

  it("also hardens the storage path (shared buildOptions)", () => {
    const out = sanitizeEmailHtmlForStorage(
      '<a href="\uFEFFjavascript:alert(1)">c</a>',
    );
    expect(out).not.toMatch(/javascript:/i);
  });

  it("drops SVG and other non-raster data-URI images, keeps raster", () => {
    // <img>-loaded SVG runs script-disabled in browsers and most mail clients
    // block it, but SVG is the one markup/script-bearing image type, so the
    // allowlist no longer admits it (the editor only ever emits raster images).
    const svg = sanitizeEmailHtmlForSend(
      '<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"><p>after</p>',
    );
    expect(svg).not.toMatch(/svg\+xml/i);
    expect(svg).not.toContain("<img");
    expect(svg).toContain("<p>after</p>");

    const texthtml = sanitizeEmailHtmlForSend(
      '<img src="data:text/html;base64,PHNjcmlwdD4="><p>after</p>',
    );
    expect(texthtml).not.toContain("<img");
    expect(texthtml).toContain("<p>after</p>");

    const png = sanitizeEmailHtmlForSend(
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">',
    );
    expect(png).toContain("data:image/png;base64,");
  });
});
