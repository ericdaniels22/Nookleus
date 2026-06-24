import { describe, it, expect } from "vitest";
import {
  contrastingTextColor,
  renderContractEmailFrame,
  type ContractEmailFrameInput,
} from "./email-frame";

function frameInput(
  overrides: Partial<ContractEmailFrameInput> = {},
): ContractEmailFrameInput {
  return {
    kind: "signing_request",
    companyName: "AAA Disaster Recovery",
    logoUrl: "https://cdn.test/logo.png",
    logoVisible: true,
    buttonLabel: "Review & sign",
    buttonColor: "#1f2937",
    senderName: "Jane Estimator",
    senderEmail: "jane@aaa.test",
    message: "<p>Hi Pat, please review the agreement.</p>",
    actionUrl: "https://app.test/sign/tok123",
    documentTitle: "Roof Replacement Agreement",
    ...overrides,
  };
}

describe("contrastingTextColor (#691)", () => {
  it("returns light text on a dark button color", () => {
    expect(contrastingTextColor("#1f2937")).toBe("#ffffff");
  });

  it("returns dark text on a pale button color", () => {
    expect(contrastingTextColor("#f3f4f6")).toBe("#1a1a1a");
  });

  it("returns light text on a strong red button color", () => {
    expect(contrastingTextColor("#dc2626")).toBe("#ffffff");
  });

  it("accepts a 6-digit hex without the leading hash", () => {
    expect(contrastingTextColor("1f2937")).toBe("#ffffff");
  });

  it("falls back to dark text when the color cannot be parsed", () => {
    expect(contrastingTextColor("not-a-color")).toBe("#1a1a1a");
    expect(contrastingTextColor("")).toBe("#1a1a1a");
  });
});

describe("renderContractEmailFrame — signing request (#691)", () => {
  it("embeds the already-sanitized message verbatim", () => {
    const html = renderContractEmailFrame(
      frameInput({ message: "<p>Hi Pat, please review the agreement.</p>" }),
    );
    expect(html).toContain("<p>Hi Pat, please review the agreement.</p>");
  });

  it("links the action button to the signing url", () => {
    const html = renderContractEmailFrame(
      frameInput({ actionUrl: "https://app.test/sign/tok123" }),
    );
    expect(html).toContain('href="https://app.test/sign/tok123"');
  });

  it("labels the action button with the configured button label", () => {
    const html = renderContractEmailFrame(
      frameInput({ buttonLabel: "Open & sign now" }),
    );
    expect(html).toContain("Open &amp; sign now");
  });

  it("paints the button background with the configured color and a contrasting label", () => {
    const html = renderContractEmailFrame(
      frameInput({ buttonColor: "#dc2626" }),
    );
    expect(html).toContain("background-color:#dc2626");
    // strong red → light label (Module B)
    expect(html).toContain("color:#ffffff");
  });

  it("names the company in the headline", () => {
    const html = renderContractEmailFrame(
      frameInput({ companyName: "AAA Disaster Recovery" }),
    );
    expect(html).toContain(
      "AAA Disaster Recovery sent you a document to review and sign",
    );
  });

  it("shows the sender in an in-body from line", () => {
    const html = renderContractEmailFrame(
      frameInput({ senderName: "Jane Estimator", senderEmail: "jane@aaa.test" }),
    );
    expect(html).toContain("Jane Estimator");
    expect(html).toContain("jane@aaa.test");
  });

  it("shows the company logo and a small Powered by Nookleus footer when the logo is visible", () => {
    const html = renderContractEmailFrame(
      frameInput({ logoVisible: true, logoUrl: "https://cdn.test/logo.png" }),
    );
    expect(html).toContain('src="https://cdn.test/logo.png"');
    expect(html).toContain("Powered by Nookleus");
  });

  it("drops the logo and leads with the company wordmark plus a prominent Nookleus mark when the logo is hidden", () => {
    const html = renderContractEmailFrame(
      frameInput({
        logoVisible: false,
        logoUrl: "https://cdn.test/logo.png",
        companyName: "AAA Disaster Recovery",
      }),
    );
    expect(html).not.toContain("<img");
    // a hidden logo gets the prominent standalone mark, not the tiny credit
    expect(html).not.toContain("Powered by");
    expect(html).toContain("Nookleus");
    // the company wordmark leads in addition to the headline sentence
    const occurrences = html.split("AAA Disaster Recovery").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("treats a missing logo url the same as a hidden logo", () => {
    const html = renderContractEmailFrame(
      frameInput({ logoVisible: true, logoUrl: null }),
    );
    expect(html).not.toContain("<img");
  });

  it("includes a document icon in the signing-request layout", () => {
    const html = renderContractEmailFrame(frameInput());
    expect(html).toContain("📄");
  });

  it("wraps the card in a presentation table for email-client robustness", () => {
    const html = renderContractEmailFrame(frameInput());
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
  });

  it("emits exactly one action button (single-button signing-request layout)", () => {
    const html = renderContractEmailFrame(frameInput());
    expect(html.split("<a ").length - 1).toBe(1);
  });
});

describe("renderContractEmailFrame — reminder (#692)", () => {
  it("renders a reminder headline naming the company, not the initial-send copy", () => {
    const html = renderContractEmailFrame(
      frameInput({ kind: "reminder", companyName: "AAA Disaster Recovery" }),
    );
    expect(html).toContain(
      "Reminder: AAA Disaster Recovery is waiting for your signature",
    );
    // It must read like a reminder, not the first-send headline.
    expect(html).not.toContain("sent you a document to review and sign");
  });

  it("swaps the document icon for a reminder bell glyph", () => {
    const html = renderContractEmailFrame(frameInput({ kind: "reminder" }));
    expect(html).toContain("🔔");
    expect(html).not.toContain("📄");
  });

  it("carries the same single action button + signing link as the initial email (ADR 0017 §4)", () => {
    const html = renderContractEmailFrame(
      frameInput({
        kind: "reminder",
        actionUrl: "https://app.test/sign/tok999",
        buttonLabel: "Review & sign",
        buttonColor: "#1f2937",
      }),
    );
    expect(html).toContain('href="https://app.test/sign/tok999"');
    expect(html).toContain("Review &amp; sign");
    expect(html).toContain("background-color:#1f2937");
    // identical single-button layout — the frame/button don't change by kind
    expect(html.split("<a ").length - 1).toBe(1);
    expect(html).toContain('role="presentation"');
  });

  it("embeds the already-sanitized message verbatim in a reminder", () => {
    const html = renderContractEmailFrame(
      frameInput({ kind: "reminder", message: "<p>Just a quick nudge to wrap this up.</p>" }),
    );
    expect(html).toContain("<p>Just a quick nudge to wrap this up.</p>");
  });
});
