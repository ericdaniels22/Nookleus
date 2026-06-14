import { describe, it, expect } from "vitest";
import { insertTemplateBody } from "./insert-template";
import { renderSignatureRegion } from "./signature-swap";

describe("insertTemplateBody", () => {
  it("inserts the template into an empty message body", () => {
    const result = insertTemplateBody("", "<p>Thanks for reaching out!</p>");
    expect(result).toContain("Thanks for reaching out!");
  });

  it("inserts above the signature, preserving typed content and the signature", () => {
    const body = "<p>Hi there</p>" + renderSignatureRegion("<p>Best, Jane</p>");
    const result = insertTemplateBody(body, "<p>Template body</p>");
    expect(result).toContain("Hi there");
    expect(result).toContain("Best, Jane");
    // The template lands between the typed message and the signature.
    expect(result.indexOf("Template body")).toBeGreaterThan(
      result.indexOf("Hi there"),
    );
    expect(result.indexOf("Template body")).toBeLessThan(
      result.indexOf("Best, Jane"),
    );
  });

  it("appends the template after typed content when there is no signature", () => {
    const body = "<p>My message</p>";
    const result = insertTemplateBody(body, "<p>Template body</p>");
    expect(result).toContain("My message");
    expect(result.indexOf("My message")).toBeLessThan(
      result.indexOf("Template body"),
    );
  });

  it("does not treat the marker substring as the region when inserting a template", () => {
    // Pasted/quoted email HTML whose class merely CONTAINS the marker substring
    // is not the real region. With no real region present, the template must
    // append after the existing content — never split the pasted block by being
    // spliced "above" a phantom region.
    const pasted =
      '<div class="data-signature-block-quote"><p>Pasted thread</p></div>';
    const result = insertTemplateBody(pasted, "<p>Template body</p>");
    expect(result).toContain("Pasted thread");
    expect(result.indexOf("Pasted thread")).toBeLessThan(
      result.indexOf("Template body"),
    );
  });

  it("inserts above the signature even with nested signature markup and a quoted reply below", () => {
    // The realistic forward/reply shape: a logo signature (nested <div>s) with a
    // quoted thread below it. The template must land above the whole signature
    // block — never inside it and never inside the quoted reply.
    const logoSig =
      '<div class="logo"><img src="x"><span>Jane</span></div><p>Acme Inc</p>';
    const body =
      "<p>Top message</p>" +
      renderSignatureRegion(logoSig) +
      "<p>Quoted reply</p>";
    const result = insertTemplateBody(body, "<p>Template body</p>");
    expect(result).toContain("Top message");
    expect(result).toContain("Acme Inc");
    expect(result).toContain("Quoted reply");
    expect(result.indexOf("Template body")).toBeGreaterThan(
      result.indexOf("Top message"),
    );
    expect(result.indexOf("Template body")).toBeLessThan(
      result.indexOf("Jane"),
    );
    expect(result.indexOf("Template body")).toBeLessThan(
      result.indexOf("Acme Inc"),
    );
  });
});
